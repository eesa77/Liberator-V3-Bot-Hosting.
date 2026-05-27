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

const masssayCommand = new SlashCommandBuilder()
  .setName("masssay")
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

// ---------------------------------------------------------------------------
// Register commands with Discord
// ---------------------------------------------------------------------------

async function registerCommands(clientId) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering global slash commands...");
    await rest.put(Routes.applicationCommands(clientId), {
      body: [sayCommand.toJSON(), masssayCommand.toJSON()],
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

    if (interaction.commandName === "masssay") {
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
    const text = messageStore.get(msgId);

    if (!text) {
      await interaction.reply({
        content: "This session has expired. Run the command again.",
        ephemeral: true,
      });
      return;
    }

    if (action === "fire") {
      // Acknowledge the button press without changing the original message
      await interaction.deferUpdate();
      // Send 5 follow-up messages
      for (let i = 0; i < 5; i++) {
        await interaction.followUp({ content: text });
      }
      return;
    }

    if (action === "more") {
      // Acknowledge without editing the original message
      await interaction.deferUpdate();
      // Spawn a brand-new message with fresh buttons
      await interaction.followUp({
        content: text,
        components: [getSpamRow(msgId)],
      });
      return;
    }
  }
});

client.login(TOKEN);
