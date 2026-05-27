const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

// In-memory store mapping a short numeric ID to the message text.
// Survives for the lifetime of the process.
const messageStore = new Map();
let counter = 0;

function storeMessage(text) {
  const id = String(counter++);
  messageStore.set(id, text);
  return id;
}

function getSpamRow(msgId) {
  const fire = new ButtonBuilder()
    .setCustomId(`fire:${msgId}`)
    .setLabel("Fire")
    .setStyle(ButtonStyle.Danger);

  const more = new ButtonBuilder()
    .setCustomId(`more:${msgId}`)
    .setLabel("More Buttons")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(fire, more);
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const sayCommand = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Make the bot repeat a message")
  .addStringOption((opt) =>
    opt
      .setName("message")
      .setDescription("The message to send")
      .setRequired(true)
  )
  .setIntegrationTypes([
    ApplicationIntegrationType.GuildInstall,
    ApplicationIntegrationType.UserInstall,
  ])
  .setContexts([
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  ]);

const raidCommand = new SlashCommandBuilder()
  .setName("raid")
  .setDescription(
    "Spawn a Fire button that blasts 5 copies of your message per press"
  )
  .addStringOption((opt) =>
    opt
      .setName("message")
      .setDescription("The message to spam")
      .setRequired(true)
  )
  .setIntegrationTypes([
    ApplicationIntegrationType.GuildInstall,
    ApplicationIntegrationType.UserInstall,
  ])
  .setContexts([
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  ]);

const terraformCommand = new SlashCommandBuilder()
  .setName("terraform")
  .setDescription("Repurpose this server by archiving all channels and roles")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts([InteractionContextType.Guild]);

// ---------------------------------------------------------------------------
// Register commands with Discord
// ---------------------------------------------------------------------------

async function registerCommands(clientId) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering global slash commands...");
    await rest.put(Routes.applicationCommands(clientId), {
      body: [sayCommand.toJSON(), raidCommand.toJSON(), terraformCommand.toJSON()],
    });
    console.log("Slash commands registered successfully.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(client.user.id);
});

client.on("interactionCreate", async (interaction) => {
  // ------------------------------------------------------------------
  // Slash commands
  // ------------------------------------------------------------------
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "say") {
      const text = interaction.options.getString("message");
      await interaction.reply({ content: text });
      return;
    }

    if (interaction.commandName === "terraform") {
      const confirmBtn = new ButtonBuilder()
        .setCustomId("terraform:confirm")
        .setLabel("Yes, archive this server")
        .setStyle(ButtonStyle.Danger);

      const cancelBtn = new ButtonBuilder()
        .setCustomId("terraform:cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

      await interaction.reply({
        content:
          "This will delete every channel, delete every non-default role, and rename this server to **[Archived Server]**. This cannot be undone. Are you sure?",
        components: [row],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "raid") {
      const text = interaction.options.getString("message");
      const msgId = storeMessage(text);
      await interaction.reply({
        content: text,
        components: [getSpamRow(msgId)],
      });
      return;
    }
  }

  // ------------------------------------------------------------------
  // Button interactions
  // ------------------------------------------------------------------
  if (interaction.isButton()) {
    const [action, msgId] = interaction.customId.split(":");

    if (action === "terraform") {
      if (msgId === "cancel") {
        await interaction.update({
          content: "Cancelled.",
          components: [],
        });
        return;
      }

      if (msgId === "confirm") {
        await interaction.update({
          content: "Archiving server...",
          components: [],
        });

        const guild = interaction.guild;

        // Delete all channels
        const channels = await guild.channels.fetch();
        for (const [, channel] of channels) {
          try {
            await channel.delete();
          } catch (_) {}
        }

        // Delete all non-default roles (@everyone and bot-managed roles cannot be deleted)
        const roles = await guild.roles.fetch();
        for (const [, role] of roles) {
          if (role.managed || role.name === "@everyone") continue;
          try {
            await role.delete();
          } catch (_) {}
        }

        // Rename the server
        try {
          await guild.setName("[Archived Server]");
        } catch (_) {}

        return;
      }
    }

    const text = messageStore.get(msgId);

    if (!text) {
      await interaction.reply({
        content: "This session has expired. Run the command again.",
        ephemeral: true,
      });
      return;
    }

    if (action === "fire") {
      await interaction.deferUpdate();
      for (let i = 0; i < 5; i++) {
        await interaction.followUp({ content: text });
      }
      return;
    }

    if (action === "more") {
      await interaction.deferUpdate();
      await interaction.followUp({
        content: text,
        components: [getSpamRow(msgId)],
      });
      return;
    }
  }
});

client.login(TOKEN);
