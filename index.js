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
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

const messageStore = new Map();
let counter = 0;

function storePayload(payload) {
  const id = String(counter++);
  messageStore.set(id, payload);
  return id;
}

function getSpamRow(prefix, msgId) {
  const fire = new ButtonBuilder()
    .setCustomId(`${prefix}fire:${msgId}`)
    .setLabel("Fire")
    .setStyle(ButtonStyle.Danger);
  const more = new ButtonBuilder()
    .setCustomId(`${prefix}more:${msgId}`)
    .setLabel("More Buttons")
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(fire, more);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DOCKING_FILE = "./docking-points.json";

function loadDockingPoints() {
  try {
    return new Map(JSON.parse(fs.readFileSync(DOCKING_FILE, "utf8")));
  } catch {
    return new Map();
  }
}

function saveDockingPoints() {
  fs.writeFileSync(DOCKING_FILE, JSON.stringify([...dockingPoints]));
}

const dockingPoints = loadDockingPoints();

const sayCommand = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Make the bot repeat a message")
  .addStringOption((opt) =>
    opt.setName("message").setDescription("The message to send").setRequired(true)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const raidCommand = new SlashCommandBuilder()
  .setName("raid")
  .setDescription("Spawn a Fire button that blasts 5 copies of your message per press")
  .addStringOption((opt) =>
    opt.setName("message").setDescription("The message to spam").setRequired(true)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const pollraidCommand = new SlashCommandBuilder()
  .setName("pollraid")
  .setDescription("Spawn a Fire button that blasts 5 Discord polls per press")
  .addBooleanOption((opt) =>
    opt.setName("use_default").setDescription('Use the default "Who Wins?" poll').setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("question").setDescription("Custom poll question (ignored if use_default is true)").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("answers").setDescription("Comma-separated answers, e.g. Yes,No,Maybe").setRequired(false)
  )
  .addIntegerOption((opt) =>
    opt.setName("duration").setDescription("Poll duration in hours (1-32, default 24)").setMinValue(1).setMaxValue(32).setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const terraformCommand = new SlashCommandBuilder()
  .setName("terraform")
  .setDescription("Repurpose this server by archiving all channels and roles")
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
  .setContexts([InteractionContextType.Guild])
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const dockingSetCommand = new SlashCommandBuilder()
  .setName("dockingpointset")
  .setDescription("Save this location as a named docking point")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Name for this docking point").setRequired(true)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const dockingLocateCommand = new SlashCommandBuilder()
  .setName("dockingpointlocate")
  .setDescription("Get a jump link to a saved docking point")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Name of the docking point").setRequired(true).setAutocomplete(true)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const dockingDeleteCommand = new SlashCommandBuilder()
  .setName("dockingpointdelete")
  .setDescription("Delete a saved docking point")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Name of the docking point to delete").setRequired(true).setAutocomplete(true)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const freeNitroCommand = new SlashCommandBuilder()
  .setName("freenitro")
  .setDescription("Claim your free Discord Nitro")
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

async function registerCommands(clientId) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering global slash commands...");
    await rest.put(Routes.applicationCommands(clientId), {
      body: [
        sayCommand.toJSON(),
        raidCommand.toJSON(),
        pollraidCommand.toJSON(),
        terraformCommand.toJSON(),
        dockingSetCommand.toJSON(),
        dockingLocateCommand.toJSON(),
        dockingDeleteCommand.toJSON(),
        freeNitroCommand.toJSON(),
      ],
    });
    console.log("Slash commands registered successfully.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(client.user.id);
});

client.on("interactionCreate", async (interaction) => {

  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused().toLowerCase();
    if (interaction.commandName === "dockingpointlocate" || interaction.commandName === "dockingpointdelete") {
      const matches = [...dockingPoints.keys()]
        .filter((name) => name.includes(focused))
        .slice(0, 25)
        .map((name) => ({ name, value: name }));
      await interaction.respond(matches);
    }
    return;
  }

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "say") {
      await interaction.reply({ content: interaction.options.getString("message") });
      return;
    }

    if (interaction.commandName === "raid") {
      const text = interaction.options.getString("message");
      const id = storePayload({ type: "text", content: text });
      await interaction.reply({ content: text, components: [getSpamRow("r", id)] });
      return;
    }

    if (interaction.commandName === "pollraid") {
      const useDefault = interaction.options.getBoolean("use_default");
      const duration = interaction.options.getInteger("duration") ?? 24;
      let question, answers;

      if (useDefault) {
        question = "Who Wins?";
        answers = ["L", "I", "B", "E", "R", "T", "Y"];
      } else {
        question = interaction.options.getString("question");
        const rawAnswers = interaction.options.getString("answers");
        if (!question || !rawAnswers) {
          await interaction.reply({ content: "Provide both a question and answers, or set use_default to True.", ephemeral: true });
          return;
        }
        answers = rawAnswers.split(",").map((a) => a.trim()).filter(Boolean);
        if (answers.length < 2) {
          await interaction.reply({ content: "Provide at least 2 answers.", ephemeral: true });
          return;
        }
        if (answers.length > 10) {
          await interaction.reply({ content: "Discord polls support a maximum of 10 answers.", ephemeral: true });
          return;
        }
      }

      const id = storePayload({ type: "poll", question, answers, duration });
      await interaction.reply({ content: `Poll: ${question}`, components: [getSpamRow("p", id)] });
      return;
    }

    if (interaction.commandName === "terraform") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("terraform:confirm").setLabel("Yes, archive this server").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("terraform:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        content: `Archive **${interaction.guild.name}**?\n\nThis will delete every channel, every non-default role, and rename the server to **[Archived Server]**. This cannot be undone.`,
        components: [row],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "dockingpointset") {
      const name = interaction.options.getString("name");
      await interaction.reply({ content: `Docking point **${name}** set here. Use /dockingpointlocate to jump back.` });
      const reply = await interaction.fetchReply();
      const guildOrDM = interaction.guildId ?? "@me";
      const url = `https://discord.com/channels/${guildOrDM}/${reply.channelId}/${reply.id}`;
      dockingPoints.set(name.toLowerCase(), url);
      saveDockingPoints();
      return;
    }

    if (interaction.commandName === "dockingpointlocate") {
      const name = interaction.options.getString("name");
      const url = dockingPoints.get(name.toLowerCase());
      if (!url) {
        await interaction.reply({ content: `No docking point named **${name}** found. Set one first with /dockingpointset.`, ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(`Jump to: ${name}`).setURL(url).setStyle(ButtonStyle.Link)
      );
      await interaction.reply({ content: `Docking point **${name}**`, components: [row] });
      return;
    }

    if (interaction.commandName === "dockingpointdelete") {
      const name = interaction.options.getString("name").toLowerCase();
      if (!dockingPoints.has(name)) {
        await interaction.reply({ content: `No docking point named **${name}** found.`, ephemeral: true });
        return;
      }
      dockingPoints.delete(name);
      saveDockingPoints();
      await interaction.reply({ content: `Docking point **${name}** deleted.`, ephemeral: true });
      return;
    }

    if (interaction.commandName === "freenitro") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("freenitro:claim").setLabel("Claim Free Nitro").setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({
        content: "You have been gifted Discord Nitro! Click below to claim it before it expires.",
        components: [row],
      });
      return;
    }
  }

  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId === "freenitro:claim") {
      await interaction.update({
        content: "https://media.tenor.com/x8v1oNUOmg4AAAAd/rickroll-roll.gif",
        components: [],
      });
      return;
    }

    if (customId === "terraform:cancel") {
      await interaction.update({ content: "Cancelled.", components: [] });
      return;
    }

    if (customId === "terraform:confirm") {
      const guild = interaction.guild;

      const botMember = guild.members.me;
      if (botMember) {
        const missing = botMember.permissions.missing([
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ManageGuild,
        ]);
        if (missing.length > 0) {
          await interaction.update({
            content: `The bot is missing permissions: **${missing.join(", ")}**. Re-invite it with Administrator.`,
            components: [],
          });
          return;
        }
      }

      // Single update() satisfies Discord's 3-second window. Deletions happen after.
      await interaction.update({ content: "Archiving server...", components: [] });

      try {
        const channels = await guild.channels.fetch();
        for (const [, channel] of channels) {
          if (!channel) continue;
          try { await channel.delete(); } catch (_) {}
        }
      } catch (err) { console.error("Error fetching channels:", err); }

      try {
        const roles = await guild.roles.fetch();
        for (const [, role] of roles) {
          if (!role || role.managed || role.name === "@everyone") continue;
          try { await role.delete(); } catch (_) {}
        }
      } catch (err) { console.error("Error fetching roles:", err); }

      try { await guild.setName("[Archived Server]"); } catch (_) {}
      return;
    }

    if (customId.startsWith("rfire:") || customId.startsWith("rmore:")) {
      const colon = customId.indexOf(":");
      const action = customId.slice(1, colon);
      const id = customId.slice(colon + 1);
      const payload = messageStore.get(id);
      if (!payload) {
        await interaction.reply({ content: "This session has expired. Run the command again.", ephemeral: true });
        return;
      }
      if (action === "fire") {
        await interaction.deferUpdate();
        for (let i = 0; i < 5; i++) {
          try { await interaction.followUp({ content: payload.content }); await sleep(300); }
          catch (err) { console.error("raid followUp error:", err); }
        }
        return;
      }
      if (action === "more") {
        await interaction.deferUpdate();
        await interaction.followUp({ content: payload.content, components: [getSpamRow("r", id)] });
        return;
      }
    }

    if (customId.startsWith("pfire:") || customId.startsWith("pmore:")) {
      const colon = customId.indexOf(":");
      const action = customId.slice(1, colon);
      const id = customId.slice(colon + 1);
      const payload = messageStore.get(id);
      if (!payload) {
        await interaction.reply({ content: "This session has expired. Run the command again.", ephemeral: true });
        return;
      }
      const pollData = {
        question: { text: payload.question },
        answers: payload.answers.map((a) => ({ text: a })),
        duration: payload.duration,
        allowMultiselect: false,
      };
      if (action === "fire") {
        await interaction.deferUpdate();
        for (let i = 0; i < 5; i++) {
          try { await interaction.followUp({ poll: pollData }); await sleep(500); }
          catch (err) { console.error(`pollraid followUp ${i + 1} error:`, err); }
        }
        return;
      }
      if (action === "more") {
        await interaction.deferUpdate();
        await interaction.followUp({ content: `Poll: ${payload.question}`, components: [getSpamRow("p", id)] });
        return;
      }
    }
  }
});

client.login(TOKEN);
