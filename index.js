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
  AttachmentBuilder,
} = require("discord.js");
const fs = require("fs");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

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
  fs.writeFileSync(DOCKING_FILE, JSON.stringify([...dockingPoints]));
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
  fs.writeFileSync(HITLIST_FILE, JSON.stringify([...hitlist]));
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function buildHitlistCard(entry) {
  const threat = THREAT[entry.threatLevel] ?? THREAT[1];
  const W = 660;
  const H = 260;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = threat.color;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, 0, 215, H);

  const AX = 107;
  const AY = 130;
  const AR = 84;

  try {
    const img = await loadImage(entry.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(AX, AY, AR + 5, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(AX, AY, AR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, AX - AR, AY - AR, AR * 2, AR * 2);
    ctx.restore();
  } catch {
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.arc(AX, AY, AR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("?", AX, AY + 10);
    ctx.textAlign = "left";
  }

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(215, 18);
  ctx.lineTo(215, H - 18);
  ctx.stroke();

  const TX = 234;

  ctx.fillStyle = threat.color;
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("H I T L I S T", TX, 38);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, W - 160, 16, 148, 28, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${threat.name}  THREAT`, W - 18, 35);
  ctx.textAlign = "left";

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 27px sans-serif";
  const dname = entry.displayName.length > 22
    ? entry.displayName.slice(0, 21) + "\u2026"
    : entry.displayName;
  ctx.fillText(dname, TX, 90);

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "16px sans-serif";
  ctx.fillText(`@${entry.username || "unknown"}`, TX, 122);

  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.font = "13px sans-serif";
  ctx.fillText(`ID: ${entry.userId}`, TX, 150);

  ctx.font = "23px sans-serif";
  let sx = TX;
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i < entry.threatLevel ? "#FFD700" : "rgba(255,255,255,0.12)";
    ctx.fillText("\u2605", sx, 195);
    sx += 27;
  }

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText(`THREAT LEVEL ${entry.threatLevel}/6  \u2014  ${threat.label}`, TX, 228);

  return canvas.toBuffer("image/png");
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
    opt.setName("username").setDescription("Username of the target (autocompletes existing entries)").setRequired(true).setAutocomplete(true)
  )
  .addIntegerOption((opt) =>
    opt.setName("threatlevel")
      .setDescription("1=Blue(Low) 2=Green(Moderate) 3=Yellow(Elevated) 4=Orange(High) 5=Red(Severe) 6=Purple(Extreme)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(6)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const viewHitlistCommand = new SlashCommandBuilder()
  .setName("viewhitlist")
  .setDescription("View a target's hitlist card")
  .addStringOption((opt) =>
    opt.setName("target").setDescription("Username or display name of the target").setRequired(true).setAutocomplete(true)
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
        await interaction.reply({ content: `No docking point named **${name}** found.`, ephemeral: true });
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

    if (interaction.commandName === "uploadhitlist") {
      await interaction.deferReply();

      const userId      = interaction.options.getString("userid").trim();
      const displayName = interaction.options.getString("displayname").trim();
      const username    = interaction.options.getString("username").trim();
      const threatLevel = interaction.options.getInteger("threatlevel");

      let avatarUrl;
      try {
        const user = await client.users.fetch(userId);
        avatarUrl = user.displayAvatarURL({ size: 256, extension: "png" });
      } catch {
        await interaction.editReply({ content: `Could not find a Discord user with ID **${userId}**. Make sure it is a valid User ID.` });
        return;
      }

      const entry = { userId, username, displayName, avatarUrl, threatLevel };
      hitlist.set(userId, entry);
      saveHitlist();

      let cardBuffer;
      try {
        cardBuffer = await buildHitlistCard(entry);
      } catch (err) {
        console.error("Canvas error:", err);
        await interaction.editReply({ content: "Entry saved but failed to generate the card image." });
        return;
      }

      const attachment = new AttachmentBuilder(cardBuffer, { name: "hitlist-card.png" });
      const threat = THREAT[threatLevel];
      await interaction.editReply({
        content: `**${displayName}** added to the hitlist. Threat level: **${threat.name} (${threat.label})**`,
        files: [attachment],
      });
      return;
    }

    if (interaction.commandName === "viewhitlist") {
      await interaction.deferReply();

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

      let cardBuffer;
      try {
        cardBuffer = await buildHitlistCard(entry);
      } catch (err) {
        console.error("Canvas error:", err);
        await interaction.editReply({ content: "Failed to generate the hitlist card." });
        return;
      }

      const attachment = new AttachmentBuilder(cardBuffer, { name: "hitlist-card.png" });
      await interaction.editReply({ files: [attachment] });
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
