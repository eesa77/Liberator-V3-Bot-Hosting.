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

// ---------------------------------------------------------------------------
// In-memory store for button payloads
// ---------------------------------------------------------------------------

const messageStore = new Map();
let counter = 0;

function storePayload(payload) {
  const id = String(counter++);
  messageStore.set(id, { ...payload, _ts: Date.now() });
  return id;
}

// Clean up payloads older than 24 hours to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, val] of messageStore) {
    if (val._ts < cutoff) messageStore.delete(key);
  }
}, 60 * 60 * 1000);

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

// ---------------------------------------------------------------------------
// Docking points  (docking-points.json)
// ---------------------------------------------------------------------------

const DOCKING_FILE = "./docking-points.json";

function loadDockingPoints() {
  try { return new Map(JSON.parse(fs.readFileSync(DOCKING_FILE, "utf8"))); }
  catch { return new Map(); }
}
function saveDockingPoints() {
  try { fs.writeFileSync(DOCKING_FILE, JSON.stringify([...dockingPoints])); }
  catch (e) { console.error("Could not save docking-points.json:", e); }
}

const dockingPoints = loadDockingPoints();

// ---------------------------------------------------------------------------
// Hitlist  (hitlist.json)
// ---------------------------------------------------------------------------

const HITLIST_FILE = "./hitlist.json";

function loadHitlist() {
  try { return new Map(JSON.parse(fs.readFileSync(HITLIST_FILE, "utf8"))); }
  catch { return new Map(); }
}
function saveHitlist() {
  try { fs.writeFileSync(HITLIST_FILE, JSON.stringify([...hitlist])); }
  catch (e) { console.error("Could not save hitlist.json:", e); }
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
// DM Contacts  (dm-contacts.json)
// ---------------------------------------------------------------------------

const DM_CONTACTS_FILE = "./dm-contacts.json";

function loadDmContacts() {
  try { return new Map(JSON.parse(fs.readFileSync(DM_CONTACTS_FILE, "utf8"))); }
  catch { return new Map(); }
}
function saveDmContacts() {
  try { fs.writeFileSync(DM_CONTACTS_FILE, JSON.stringify([...dmContacts])); }
  catch (e) { console.error("Could not save dm-contacts.json:", e); }
}

const dmContacts = loadDmContacts();

// ---------------------------------------------------------------------------
// Charge Raid helpers
// ---------------------------------------------------------------------------
// IMPORTANT: every button in a message must have a UNIQUE custom ID.
// We encode a position index into each ID so the 20 charge buttons are all
// distinct, but the handler only needs the amount (parts[2]).
// Format:  crc:<sessionId>:<amount>:<uniquePos>
// ---------------------------------------------------------------------------

function getChargeRaidRows(id, charged) {
  const rows = [];
  const grid = [
    [1,  1,  1,  1,  1 ],
    [5,  5,  5,  5,  5 ],
    [10, 10, 10, 10, 10],
    [25, 25, 25, 25, 25],
  ];
  let pos = 0;
  for (const amounts of grid) {
    const btns = amounts.map((n) =>
      new ButtonBuilder()
        .setCustomId(`crc:${id}:${n}:${pos++}`)   // pos makes every ID unique
        .setLabel(`+${n}`)
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(new ActionRowBuilder().addComponents(...btns));
  }
  const releaseBtn = new ButtonBuilder()
    .setCustomId(`crr:${id}`)
    .setLabel(charged > 0 ? `RELEASE  (${charged})` : "RELEASE")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(charged === 0);
  const resetBtn = new ButtonBuilder()
    .setCustomId(`crz:${id}`)
    .setLabel("RESET")
    .setStyle(ButtonStyle.Primary);
  rows.push(new ActionRowBuilder().addComponents(releaseBtn, resetBtn));
  return rows;
}

function chargeRaidContent(content, charged) {
  return `**Charge Raid**\nMessage: ${content}\nCharged: **${charged}** message${charged === 1 ? "" : "s"} ready to fire`;
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
    opt.setName("interval").setDescription("Seconds between each message (0.1-1.0, default 1.0)").setMinValue(0.1).setMaxValue(1.0).setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the launcher — spam is still public").setRequired(false)
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
    opt.setName("count").setDescription("Polls fired per click (3-20, default 5)").setMinValue(3).setMaxValue(20).setRequired(false)
  )
  .addNumberOption((opt) =>
    opt.setName("interval").setDescription("Seconds between each poll (0.1-1.0, default 1.0)").setMinValue(0.1).setMaxValue(1.0).setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the launcher — spam is still public").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const chargeRaidCommand = new SlashCommandBuilder()
  .setName("chargeraid")
  .setDescription("Queue up messages with a button grid, then release them all at once")
  .addStringOption((opt) =>
    opt.setName("message").setDescription("The message to fire on release").setRequired(true)
  )
  .addNumberOption((opt) =>
    opt.setName("interval").setDescription("Seconds between each message on release (0.1-1.0, default 1.0)").setMinValue(0.1).setMaxValue(1.0).setRequired(false)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the grid — fired messages are still public").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const terraformCommand = new SlashCommandBuilder()
  .setName("terraform")
  .setDescription("Repurpose this server by archiving all channels and roles")
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
  .setContexts([InteractionContextType.Guild])
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const terraDmCommand = new SlashCommandBuilder()
  .setName("terradm")
  .setDescription("Send a DM to any user by their ID")
  .addStringOption((opt) =>
    opt.setName("userid").setDescription("Discord User ID (autocompletes past contacts)").setRequired(true).setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName("message").setDescription("Message to send").setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the confirmation").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const dockingSetCommand = new SlashCommandBuilder()
  .setName("dockingpointset")
  .setDescription("Save this location as a named docking point")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Name for this docking point").setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt.setName("private").setDescription("Only you can jump to this docking point (link shown ephemerally on locate)").setRequired(false)
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

const anthemCommand = new SlashCommandBuilder()
  .setName("anthem")
  .setDescription("Post the Liberator V3 bot hosting link")
  .addBooleanOption((opt) =>
    opt.setName("ephemeral").setDescription("Only you can see the response").setRequired(false)
  )
  .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

const blameCommand = new SlashCommandBuilder()
  .setName("blame")
  .setDescription("Pin the raid on someone")
  .addUserOption((opt) =>
    opt.setName("target").setDescription("The person to blame").setRequired(true)
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
  .addIntegerOption((opt) =>
    opt.setName("threatlevel")
      .setDescription("1=Blue(Low) 2=Green(Moderate) 3=Yellow(Elevated) 4=Orange(High) 5=Red(Severe) 6=Purple(Extreme)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(6)
  )
  .addStringOption((opt) =>
    opt.setName("username").setDescription("Username (optional — auto-fetched if blank)").setRequired(false).setAutocomplete(true)
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

const deleteHitlistCommand = new SlashCommandBuilder()
  .setName("deletehitlist")
  .setDescription("Remove a target from the hitlist")
  .addStringOption((opt) =>
    opt.setName("target").setDescription("Username or display name of the target to remove").setRequired(true).setAutocomplete(true)
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
        chargeRaidCommand.toJSON(),
        terraformCommand.toJSON(),
        terraDmCommand.toJSON(),
        dockingSetCommand.toJSON(),
        dockingLocateCommand.toJSON(),
        dockingDeleteCommand.toJSON(),
        freeNitroCommand.toJSON(),
        anthemCommand.toJSON(),
        blameCommand.toJSON(),
        uploadHitlistCommand.toJSON(),
        viewHitlistCommand.toJSON(),
        deleteHitlistCommand.toJSON(),
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
  try {

    // -----------------------------------------------------------------------
    // Autocomplete
    // -----------------------------------------------------------------------
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

      if (cmd === "viewhitlist" || cmd === "deletehitlist") {
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

      if (cmd === "terradm") {
        const matches = [...dmContacts.values()]
          .filter((c) => c.username.toLowerCase().includes(focused))
          .slice(0, 25)
          .map((c) => ({ name: `${c.username} (${c.userId})`, value: c.userId }));
        await interaction.respond(matches);
        return;
      }

      return;
    }

    // -----------------------------------------------------------------------
    // Slash commands
    // -----------------------------------------------------------------------
    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === "say") {
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
        await interaction.reply({ content: interaction.options.getString("message"), ephemeral });
        return;
      }

      if (interaction.commandName === "raid") {
        const text      = interaction.options.getString("message");
        const interval  = interaction.options.getNumber("interval") ?? 1.0;
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
        await interaction.reply({
          content: `Poll: ${question} — firing **${count}** per click`,
          components: [getSpamRow("p", id)],
          ephemeral,
        });
        return;
      }

      if (interaction.commandName === "chargeraid") {
        const text      = interaction.options.getString("message");
        const interval  = interaction.options.getNumber("interval") ?? 1.0;
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
        const id = storePayload({ type: "chargeraid", content: text, interval, charged: 0 });
        await interaction.reply({
          content: chargeRaidContent(text, 0),
          components: getChargeRaidRows(id, 0),
          ephemeral,
        });
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

      if (interaction.commandName === "terradm") {
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
        await interaction.deferReply({ ephemeral });
        try {
          const userId  = interaction.options.getString("userid").trim();
          const message = interaction.options.getString("message").trim();

          let user;
          try {
            user = await client.users.fetch(userId, { force: true });
          } catch {
            await interaction.editReply({ content: `Could not find a Discord user with ID **${userId}**.` });
            return;
          }

          // createDM opens the DM channel via REST — works without a mutual server
          let dmChannel;
          try {
            dmChannel = await user.createDM(true);
          } catch {
            await interaction.editReply({ content: `Could not open a DM channel with **${user.username}**.` });
            return;
          }

          try {
            await dmChannel.send(message);
          } catch {
            await interaction.editReply({ content: `Could not send a DM to **${user.username}**. They may have DMs disabled.` });
            return;
          }

          dmContacts.set(userId, { userId, username: user.username });
          saveDmContacts();

          await interaction.editReply({ content: `DM sent to **${user.username}** (${userId}).` });
        } catch (err) {
          console.error("terradm error:", err);
          try { await interaction.editReply({ content: "Something went wrong. Check the bot logs." }); } catch (_) {}
        }
        return;
      }

      if (interaction.commandName === "dockingpointset") {
        const name      = interaction.options.getString("name");
        const isPrivate = interaction.options.getBoolean("private") ?? false;
        // Anchor message must always be non-ephemeral — it needs a real channel URL.
        await interaction.reply({ content: `Docking point **${name}** set here${isPrivate ? " (private)" : ""}. Use /dockingpointlocate to jump back.`, ephemeral: false });
        const reply = await interaction.fetchReply();
        const guildOrDM = interaction.guildId ?? "@me";
        const url = `https://discord.com/channels/${guildOrDM}/${reply.channelId}/${reply.id}`;
        dockingPoints.set(name.toLowerCase(), { url, private: isPrivate });
        saveDockingPoints();
        return;
      }

      if (interaction.commandName === "dockingpointlocate") {
        const name    = interaction.options.getString("name");
        const stored  = dockingPoints.get(name.toLowerCase());
        if (!stored) {
          await interaction.reply({ content: `No docking point named **${name}** found.`, ephemeral: true });
          return;
        }
        // Support old string format and new object format { url, private }
        const url       = typeof stored === "string" ? stored : stored.url;
        const isPrivate = typeof stored === "string" ? false  : stored.private;
        const ephemeral = isPrivate || (interaction.options.getBoolean("ephemeral") ?? false);
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

      if (interaction.commandName === "anthem") {
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
        await interaction.reply({ content: "https://youtube.com/shorts/T9KK2udDHNo?si=6aGsKcsObNUMC9KD", ephemeral });
        return;
      }

      if (interaction.commandName === "blame") {
        const target = interaction.options.getUser("target");
        const id = storePayload({ type: "blame", userId: target.id, username: target.username });
        const btn = new ButtonBuilder()
          .setCustomId(`blame:${id}`)
          .setLabel(`Blame ${target.username}`)
          .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(btn);
        await interaction.reply({
          content: `Ready to blame **${target.username}**. Press the button to post — it won't show that you ran a command.`,
          components: [row],
          ephemeral: true,
        });
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
            const user = await client.users.fetch(userId, { force: true });
            avatarUrl = user.displayAvatarURL({ size: 256, extension: "png" });
            username  = interaction.options.getString("username")?.trim() || user.username;
          } catch {
            await interaction.editReply({ content: `Could not find a Discord user with ID **${userId}**.` });
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

      if (interaction.commandName === "deletehitlist") {
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
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
          await interaction.reply({ content: `No hitlist entry found for **${targetInput}**.`, ephemeral: true });
          return;
        }

        hitlist.delete(entry.userId);
        saveHitlist();
        await interaction.reply({
          content: `**${entry.displayName}** (@${entry.username}) removed from the hitlist.`,
          ephemeral,
        });
        return;
      }
    }

    // -----------------------------------------------------------------------
    // Button interactions
    // -----------------------------------------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // Blame
      if (customId.startsWith("blame:")) {
        const id      = customId.slice(6);
        const payload = messageStore.get(id);
        if (!payload) {
          await interaction.reply({ content: "This session has expired. Run /blame again.", ephemeral: true });
          return;
        }
        messageStore.delete(id); // delete immediately to prevent double-fire on Discord retries
        const disabledBtn = new ButtonBuilder()
          .setCustomId(`blame:${id}`)
          .setLabel("Sent")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);
        await interaction.update({ content: "Blame posted.", components: [new ActionRowBuilder().addComponents(disabledBtn)] });
        const redeemBtn = new ButtonBuilder()
          .setCustomId(`blameredeem:${id}`)
          .setLabel("Redeem")
          .setStyle(ButtonStyle.Primary);
        await interaction.followUp({
          content: `Thank you <@${payload.userId}> for using our Raid Bot. Due to your frequent use you are eligible for a premium upgrade.`,
          components: [new ActionRowBuilder().addComponents(redeemBtn)],
        });
        return;
      }

      // Blame redeem (does nothing)
      if (customId.startsWith("blameredeem:")) {
        await interaction.deferUpdate();
        return;
      }

      // Free Nitro
      if (customId === "freenitro:claim") {
        await interaction.update({
          content: "https://media.tenor.com/x8v1oNUOmg4AAAAd/rickroll-roll.gif",
          components: [],
        });
        return;
      }

      // Terraform
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
          for (const [, ch] of channels) {
            if (!ch) continue;
            try { await ch.delete(); } catch (_) {}
          }
        } catch (err) { console.error("Terraform channel error:", err); }
        try {
          const roles = await guild.roles.fetch();
          for (const [, role] of roles) {
            if (!role || role.managed || role.name === "@everyone") continue;
            try { await role.delete(); } catch (_) {}
          }
        } catch (err) { console.error("Terraform role error:", err); }
        try { await guild.setName("[Archived Server]"); } catch (_) {}
        return;
      }

      // Charge Raid — charge button  (crc:sessionId:amount:uniquePos)
      if (customId.startsWith("crc:")) {
        const parts   = customId.split(":");
        const id      = parts[1];
        const amount  = parseInt(parts[2], 10);
        const payload = messageStore.get(id);
        if (!payload) {
          await interaction.reply({ content: "This session has expired. Run /chargeraid again.", ephemeral: true });
          return;
        }
        payload.charged = (payload.charged ?? 0) + amount;
        await interaction.update({
          content: chargeRaidContent(payload.content, payload.charged),
          components: getChargeRaidRows(id, payload.charged),
        });
        return;
      }

      // Charge Raid — release button  (crr:sessionId)
      if (customId.startsWith("crr:")) {
        const id      = customId.slice(4);
        const payload = messageStore.get(id);
        if (!payload) {
          await interaction.reply({ content: "This session has expired. Run /chargeraid again.", ephemeral: true });
          return;
        }
        const charged = payload.charged ?? 0;
        if (charged === 0) {
          await interaction.reply({ content: "Nothing charged yet.", ephemeral: true });
          return;
        }
        payload.charged = 0;
        await interaction.update({
          content: `**Charge Raid** — firing **${charged}** messages...`,
          components: getChargeRaidRows(id, 0),
        });
        const intervalMs = Math.round((payload.interval ?? 1.0) * 1000);
        for (let i = 0; i < charged; i++) {
          try { await interaction.followUp({ content: payload.content }); await sleep(intervalMs); }
          catch (err) { console.error("chargeraid fire error:", err); }
        }
        return;
      }

      // Charge Raid — reset button  (crz:sessionId)
      if (customId.startsWith("crz:")) {
        const id      = customId.slice(4);
        const payload = messageStore.get(id);
        if (!payload) {
          await interaction.reply({ content: "This session has expired. Run /chargeraid again.", ephemeral: true });
          return;
        }
        payload.charged = 0;
        await interaction.update({
          content: chargeRaidContent(payload.content, 0),
          components: getChargeRaidRows(id, 0),
        });
        return;
      }

      // Raid buttons
      if (customId.startsWith("rfire:") || customId.startsWith("rmore:")) {
        const colon   = customId.indexOf(":");
        const action  = customId.slice(1, colon);
        const id      = customId.slice(colon + 1);
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

      // Pollraid buttons
      if (customId.startsWith("pfire:") || customId.startsWith("pmore:")) {
        const colon   = customId.indexOf(":");
        const action  = customId.slice(1, colon);
        const id      = customId.slice(colon + 1);
        const payload = messageStore.get(id);
        if (!payload) {
          await interaction.reply({ content: "This session has expired. Run /pollraid again.", ephemeral: true });
          return;
        }
        const pollData = {
          question:         { text: payload.question },
          answers:          payload.answers.map((a) => ({ text: a })),
          duration:         payload.duration,
          allowMultiselect: false,
        };
        const fireCount  = payload.count ?? 5;
        const intervalMs = Math.round((payload.interval ?? 1.0) * 1000);
        if (action === "fire") {
          await interaction.deferUpdate();
          for (let i = 0; i < fireCount; i++) {
            try { await interaction.followUp({ poll: pollData }); await sleep(intervalMs); }
            catch (err) { console.error(`pollraid followUp ${i + 1} error:`, err); }
          }
          return;
        }
        if (action === "more") {
          await interaction.deferUpdate();
          await interaction.followUp({
            content: `Poll: ${payload.question} — firing **${fireCount}** per click`,
            components: [getSpamRow("p", id)],
          });
          return;
        }
      }
    }

  } catch (err) {
    // Top-level catch — logs the error and attempts to respond so Discord
    // never sees "application did not respond"
    console.error("interactionCreate error:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "Something went wrong. Check the bot logs." });
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await interaction.update({ content: "Something went wrong.", components: [] });
      } else {
        await interaction.reply({ content: "Something went wrong. Check the bot logs.", ephemeral: true });
      }
    } catch (_) {}
  }
});

client.login(TOKEN);
