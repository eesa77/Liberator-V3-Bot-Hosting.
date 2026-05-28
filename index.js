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

// Docking points — saved to docking-points.json, survives index.js updates
const DOCKING_FILE = "./docking-points.json";

function loadDockingPoints() {
  try {
    return new Map(JSON.parse(fs.readFileSync(DOCKING_FILE, "utf8")));
  } catch {
    return new Map();
  }
}

function saveDockingPoints() {
  try {
    fs.writeFileSync(DOCKING_FILE, JSON.stringify([...dockingPoints]));
  } catch (e) {
    console.error("Could not save docking-points.json:", e);
  }
}

const dockingPoints = loadDockingPoints();

// Hitlist — saved to hitlist.json, survives index.js updates
const HITLIST_FILE = "./hitlist.json";

function loadHitlist() {
  try {
    return new Map(JSON.parse(fs.readFileSync(HITLIST_FILE, "utf8")));
  } catch {
    return new Map();
  }
}

function saveHitlist() {
  try {
    fs.writeFileSync(HITLIST_FILE, JSON.stringify([...hitlist]));
  } catch (e) {
    console.error("Could not save hitlist.json:", e);
  }
}

const hitlist = loadHitlist();

const THREAT = {
  1: { color: "#2E86C1", name: "BLUE",   label: "LOW"      },
  2: { color: "#1E8449", name: "GREEN",  label: "MODERATE" },
  3: { color: "#B7950B", name: "YELLOW", label: "ELEVATED" },
  4: { color: "#CA6F1E", name: "ORANGE", label: "HIGH"     },
  5: { color: "#922B21", name: "RED",    label: "SEVERE"   },
  6: { color: "#6C3483", name: "PURPLE", label: "EXTREME"  },
};

function buildHitlistEmbed(entry) {
  const threat = THREAT[entry.threatLevel] ?? THREAT[1];
  const filled = "\u2605".repeat(entry.threatLevel);
  const empty  = "\u2606".repeat(6 - entry.threatLevel);
  return {
    color: parseInt(threat.color.replace("#", ""), 16),
    author: { name: "HITLIST" },
    thumbnail: { url: entry.avatarUrl },
    fields: [
      { name: "Display Name", value: entry.displayName,                                           inline: true  },
      { name: "Username",     value: `@${entry.username}`,                                        inline: true  },
      { name: "User ID",      value: entry.userId,                                                inline: false },
      { name: "Threat Level", value: `${filled}${empty}  ${threat.name} \u2014 ${threat.label}`, inline: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const sayCommand = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Make the bot repeat a message")
  .addStringOption((opt) =>
    opt.setName("message").setDescription("The message to send").setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const raidCommand = new SlashCommandBuilder()
  .setName("raid")
  .setDescription("Spawn a Fire button that blasts copies of your message per press")
  .addStringOption((opt) =>
    opt.setName("message").setDescription("The message to spam").setRequired(true)
  )
  .addNumberOption((opt) =>
    opt.setName("interval").setDescription("Seconds between each message (0.1–1.0, default 1.0)").setMinValue(0.1).setMaxValue(1.0).setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the launcher (spam is still public)").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const pollraidCommand = new SlashCommandBuilder()
  .setName("pollraid")
  .setDescription("Spawn a Fire button that blasts Discord polls per press")
  .addBooleanOption((opt) =>
    opt.setName("use_default").setDescription('Use the default "Who Wins?" poll').setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("question").setDescription("Custom poll question").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("answers").setDescription("Comma-separated answers, e.g. Yes,No,Maybe").setRequired(false)
  )
  .addIntegerOption((opt) =>
    opt.setName("duration").setDescription("Poll duration in hours (1-32, default 24)").setMinValue(1).setMaxValue(32).setRequired(false)
  )
  .addIntegerOption((opt) =>
    opt.setName("count").setDescription("Polls per click (3–20, default 5)").setMinValue(3).setMaxValue(20).setRequired(false)
  )
  .addNumberOption((opt) =>
    opt.setName("interval").setDescription("Seconds between each poll (0.1–1.0, default 1.0)").setMinValue(0.1).setMaxValue(1.0).setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the launcher (spam is still public)").setRequired(false)
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
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const dockingLocateCommand = new SlashCommandBuilder()
  .setName("dockingpointlocate")
  .setDescription("Get a jump link to a saved docking point")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Name of the docking point").setRequired(true).setAutocomplete(true)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const dockingDeleteCommand = new SlashCommandBuilder()
  .setName("dockingpointdelete")
  .setDescription("Delete a saved docking point")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Name of the docking point to delete").setRequired(true).setAutocomplete(true)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const freeNitroCommand = new SlashCommandBuilder()
  .setName("freenitro")
  .setDescription("Claim your free Discord Nitro")
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const uploadHitlistCommand = new SlashCommandBuilder()
  .setName("uploadhitlist")
  .setDescription("Add or update a target on the hitlist")
  .addStringOption((opt) =>
    opt.setName("userid").setDescription("Discord User ID of the target").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("displayname").setDescription("Display name to show on the card").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("username").setDescription("Username (optional — auto-fetched from Discord if left blank)").setRequired(false).setAutocomplete(true)
  )
  .addIntegerOption((opt) =>
    opt.setName("threatlevel")
      .setDescription("1=Blue(Low) 2=Green(Moderate) 3=Yellow(Elevated) 4=Orange(High) 5=Red(Severe) 6=Purple(Extreme)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(6)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const viewHitlistCommand = new SlashCommandBuilder()
  .setName("viewhitlist")
  .setDescription("View a target's hitlist card")
  .addStringOption((opt) =>
    opt.setName("target").setDescription("Username or display name of the target").setRequired(true).setAutocomplete(true)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

// ---------------------------------------------------------------------------
// Register commands
// ---------------------------------------------------------------------------

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
        uploadHitlistCommand.toJSON(),
        viewHitlistCommand.toJSON(),
      ],
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

  // Autocomplete
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused().toLowerCase();
    const cmd = interaction.commandName;

    if (cmd === "dockingpointlocate" || cmd === "dockingpointdelete") {
      const matches = [...dockingPoints.keys()]
        .filter((n) => n.includes(focused))
        .slice(0, 25)
        .map((n) => ({ name: n, value: n }));
      await interaction.respond(matches);
      return;
    }

    if (cmd === "uploadhitlist") {
      const matches = [...hitlist.values()]
        .filter((e) =>
          e.username.toLowerCase().includes(focused) ||
          e.displayName.toLowerCase().includes(focused)
        )
        .slice(0, 25)
        .map((e) => ({ name: `${e.username} (${e.displayName})`, value: e.username }));
      await interaction.respond(matches);
      return;
    }

    if (cmd === "viewhitlist") {
      const matches = [...hitlist.values()]
        .filter((e) =>
          e.username.toLowerCase().includes(focused) ||
          e.displayName.toLowerCase().includes(focused)
        )
        .slice(0, 25)
        .map((e) => ({ name: `${e.displayName} (@${e.username})`, value: e.userId }));
      await interaction.respond(matches);
      return;
    }

    return;
  }

  // Slash commands
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "say") {
      const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
      await interaction.reply({ content: interaction.options.getString("message"), ephemeral });
      return;
    }

    if (interaction.commandName === "raid") {
      const text     = interaction.options.getString("message");
      const interval = interaction.options.getNumber("interval") ?? 1.0;
      const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
      const id = storePayload({ type: "text", content: text, interval });
      await interaction.reply({ content: text, components: [getSpamRow("r", id)], ephemeral });
      return;
    }

    if (interaction.commandName === "pollraid") {
      const useDefault = interaction.options.getBoolean("use_default");
      const duration   = interaction.options.getInteger("duration") ?? 24;
      const count      = interaction.options.getInteger("count") ?? 5;
      const interval   = interaction.options.getNumber("interval") ?? 1.0;
      const ephemeral  = interaction.options.getBoolean("ephemeral") ?? false;
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

      const id = storePayload({ type: "poll", question, answers, duration, count, interval });
      await interaction.reply({ content: `Poll: ${question}`, components: [getSpamRow("p", id)], ephemeral });
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
      const name      = interaction.options.getString("name");
      const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
      await interaction.reply({ content: `Docking point **${name}** set here. Use /dockingpointlocate to jump back.`, ephemeral });
      const reply = await interaction.fetchReply();
      const guildOrDM = interaction.guildId ?? "@me";
      const url = `https://discord.com/channels/${guildOrDM}/${reply.channelId}/${reply.id}`;
      dockingPoints.set(name.toLowerCase(), url);
      saveDockingPoints();
      return;
    }

    if (interaction.commandName === "dockingpointlocate") {
      const name      = interaction.options.getString("name");
      const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
      const url = dockingPoints.get(name.toLowerCase());
      if (!url) {
        await interaction.reply({ content: `No docking point named **${name}** found.`, ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(`Jump to: ${name}`).setURL(url).setStyle(ButtonStyle.Link)
      );
      await interaction.reply({ content: `Docking point **${name}**`, components: [row], ephemeral });
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
      const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("freenitro:claim").setLabel("Claim Free Nitro").setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({
        content: "You have been gifted Discord Nitro! Click below to claim it before it expires.",
        components: [row],
        ephemeral,
      });
      return;
    }

    if (interaction.commandName === "uploadhitlist") {
      const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
      await interaction.deferReply({ ephemeral });
      try {
        const userId      = interaction.options.getString("userid").trim();
        const displayName = interaction.options.getString("displayname").trim();
        const threatLevel = interaction.options.getInteger("threatlevel");

        let avatarUrl, username;
        try {
          const user = await client.users.fetch(userId);
          avatarUrl = user.displayAvatarURL({ size: 256, extension: "png" });
          username  = interaction.options.getString("username")?.trim() || user.username;
        } catch {
          await interaction.editReply({ content: `Could not find a Discord user with ID **${userId}**. Make sure it is a valid User ID.` });
          return;
        }

        const entry = { userId, username, displayName, avatarUrl, threatLevel };
        hitlist.set(userId, entry);
        saveHitlist();

        const threat = THREAT[threatLevel];
        await interaction.editReply({
          content: `**${displayName}** added to the hitlist. Threat level: **${threat.name} (${threat.label})**`,
          embeds: [buildHitlistEmbed(entry)],
        });
      } catch (err) {
        console.error("uploadhitlist error:", err);
        try { await interaction.editReply({ content: "Something went wrong. Check the bot logs." }); } catch (_) {}
      }
      return;
    }

    if (interaction.commandName === "viewhitlist") {
      const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
      await interaction.deferReply({ ephemeral });
      try {
        const targetInput = interaction.options.getString("target");
        let entry = hitlist.get(targetInput);
        if (!entry) {
          const lower = targetInput.toLowerCase();
          entry = [...hitlist.values()].find(
            (e) =>
              e.username.toLowerCase() === lower ||
              e.displayName.toLowerCase() === lower
          );
        }
        if (!entry) {
          await interaction.editReply({ content: `No hitlist entry found for **${targetInput}**.` });
          return;
        }
        await interaction.editReply({ embeds: [buildHitlistEmbed(entry)] });
      } catch (err) {
        console.error("viewhitlist error:", err);
        try { await interaction.editReply({ content: "Something went wrong. Check the bot logs." }); } catch (_) {}
      }
      return;
    }
  }

  // Button interactions
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
      const colon  = customId.indexOf(":");
      const action = customId.slice(1, colon);
      const id     = customId.slice(colon + 1);
      const payload = messageStore.get(id);
      if (!payload) {
        await interaction.reply({ content: "This session has expired. Run the command again.", ephemeral: true });
        return;
      }
      const intervalMs = Math.round((payload.interval ?? 1.0) * 1000);
      if (action === "fire") {
        await interaction.deferUpdate();
        for (let i = 0; i < 5; i++) {
          try { await interaction.followUp({ content: payload.content }); await sleep(intervalMs); }
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
      const colon  = customId.indexOf(":");
      const action = customId.slice(1, colon);
      const id     = customId.slice(colon + 1);
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
      const count      = payload.count ?? 5;
      const intervalMs = Math.round((payload.interval ?? 1.0) * 1000);
      if (action === "fire") {
        await interaction.deferUpdate();
        for (let i = 0; i
