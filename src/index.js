import {
  ActivityType,
  AttachmentBuilder,
  ChannelType,
  Client,
  ContainerBuilder,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const CONFIG = {
  token: process.env.BOT_TOKEN,
  guildId: process.env.GUILD_ID || '1537689864827445278',
  customerRoleId: process.env.CUSTOMER_ROLE_ID || '1537689864827445285',
  lockdownCategoryId: process.env.LOCKDOWN_CATEGORY_ID || '1537689865267974192',
  baptismChannelId: process.env.BAPTISM_CHANNEL_ID || '1537689865267974193',
  modLogChannelId: process.env.MOD_LOG_CHANNEL_ID || '1537728472997306389',
  dmLogChannelId: process.env.DM_LOG_CHANNEL_ID || '1541705487052046408',
  adminAlertRoleId: process.env.ADMIN_ALERT_ROLE_ID || null,
  altAlertThreshold: clampNumber(Number(process.env.ALT_ALERT_THRESHOLD || 40), 20, 100, 40),
};

const EMOJIS = {
  thumbsUpTom: '<:ThumbsupTom:1537715616369217567>',
  smileyTom: '<:SmileyTom:1537715428233715742>',
};

const BAPTISM_TEXT = `Chat has been baptized once again ${EMOJIS.thumbsUpTom}`;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const STATUS_ROTATION_INTERVAL_MS = 20_000;

const STATUS_ROTATION = [
  { type: ActivityType.Watching, text: () => 'over Bloxburg Store' },
  { type: ActivityType.Playing, text: () => 'Keeping chat clean' },
  { type: ActivityType.Watching, text: () => 'for suspicious accounts' },
  { type: ActivityType.Playing, text: () => 'Protecting the community' },
  { type: ActivityType.Watching, text: guild => `${guild?.memberCount ?? 0} members` },
  { type: ActivityType.Playing, text: () => 'Keeping things under control' },
  { type: ActivityType.Watching, text: () => 'server activity' },
];

if (!CONFIG.token) {
  console.error('[CONFIG] Missing BOT_TOKEN environment variable.');
  process.exit(1);
}
if (!CONFIG.customerRoleId) {
  console.error('[CONFIG] Missing CUSTOMER_ROLE_ID environment variable.');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

let state = loadState();
let schedulerBusy = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const commands = [
  new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Hide the emergency category from the Customer role.')
    .addStringOption(o => o.setName('reason').setDescription('Reason for the lockdown.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('unlockdown')
    .setDescription('Restore the Customer role permissions saved before lockdown.')
    .addStringOption(o => o.setName('reason').setDescription('Reason for ending the lockdown.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('baptize')
    .setDescription('Clear the configured general chat now.')
    .addStringOption(o => o.setName('reason').setDescription('Reason for the manual baptism.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages in the current channel.')
    .addIntegerOption(o => o.setName('amount').setDescription('Messages to delete (1-500).').setRequired(true).setMinValue(1).setMaxValue(500))
    .addUserOption(o => o.setName('member').setDescription('Only delete messages from this member.'))
    .addStringOption(o => o.setName('reason').setDescription('Reason for purging.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member and save it to their moderation history.')
    .addUserOption(o => o.setName('member').setDescription('Member to warn.').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Warning reason.').setRequired(true).setMaxLength(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View a member’s saved warnings.')
    .addUserOption(o => o.setName('member').setDescription('Member to inspect.').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Clear all saved warnings for a member.')
    .addUserOption(o => o.setName('member').setDescription('Member whose warnings will be cleared.').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for clearing warnings.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member.')
    .addUserOption(o => o.setName('member').setDescription('Member to timeout.').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Examples: 10m, 2h, 1d, 1w.').setRequired(true).setMaxLength(20))
    .addStringOption(o => o.setName('reason').setDescription('Timeout reason.').setRequired(true).setMaxLength(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member’s timeout.')
    .addUserOption(o => o.setName('member').setDescription('Member to remove timeout from.').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for removing timeout.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption(o => o.setName('member').setDescription('Member to kick.').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Kick reason.').setRequired(true).setMaxLength(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server.')
    .addUserOption(o => o.setName('user').setDescription('User to ban.').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Ban reason.').setRequired(true).setMaxLength(1000))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Delete this many days of their recent messages.').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by Discord user ID.')
    .addStringOption(o => o.setName('user_id').setDescription('Discord user ID.').setRequired(true).setMinLength(17).setMaxLength(20))
    .addStringOption(o => o.setName('reason').setDescription('Unban reason.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a user and automatically unban them later.')
    .addUserOption(o => o.setName('user').setDescription('User to temporarily ban.').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Examples: 1h, 3d, 2w. Maximum 365d.').setRequired(true).setMaxLength(20))
    .addStringOption(o => o.setName('reason').setDescription('Ban reason.').setRequired(true).setMaxLength(1000))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Delete this many days of recent messages.').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Ban then immediately unban a user to remove recent messages.')
    .addUserOption(o => o.setName('user').setDescription('User to softban.').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Softban reason.').setRequired(true).setMaxLength(1000))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Days of recent messages to delete. Defaults to 7.').setMinValue(1).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('baninfo')
    .setDescription('Look up a banned user and the saved temporary-ban status.')
    .addStringOption(o => o.setName('user_id').setDescription('Discord user ID.').setRequired(true).setMinLength(17).setMaxLength(20))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('Show the server ban list.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('altcheck')
    .setDescription('Run the bot alt-risk checks on a member.')
    .addUserOption(o => o.setName('member').setDescription('Member to check.').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('censorlist')
    .setDescription('List every trigger word currently blocked by the censor.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('censoradd')
    .setDescription('Add one or more trigger words to the server-wide censor.')
    .addStringOption(o => o.setName('word').setDescription('Words to block, separated by spaces or commas.').setRequired(true).setMinLength(1).setMaxLength(500))
    .addStringOption(o => o.setName('reason').setDescription('Reason for adding it.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('censorremove')
    .setDescription('Remove one or more trigger words from the server-wide censor.')
    .addStringOption(o => o.setName('word').setDescription('Words to remove, separated by spaces or commas.').setRequired(true).setMinLength(1).setMaxLength(500))
    .addStringOption(o => o.setName('reason').setDescription('Reason for removing it.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode in the current text channel.')
    .addIntegerOption(o => o.setName('seconds').setDescription('0 disables it. Maximum is 21600.').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addStringOption(o => o.setName('reason').setDescription('Reason for changing slowmode.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('lockchannel')
    .setDescription('Lock the current text channel for @everyone.')
    .addStringOption(o => o.setName('reason').setDescription('Reason for locking the channel.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('unlockchannel')
    .setDescription('Restore the current channel’s previous @everyone send permission.')
    .addStringOption(o => o.setName('reason').setDescription('Reason for unlocking the channel.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Set or reset a member nickname.')
    .addUserOption(o => o.setName('member').setDescription('Member to rename.').setRequired(true))
    .addStringOption(o => o.setName('nickname').setDescription('New nickname. Leave empty to reset.').setMaxLength(32))
    .addStringOption(o => o.setName('reason').setDescription('Reason for nickname change.').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  new SlashCommandBuilder()
    .setName('talk')
    .setDescription('Send a plain-text message through the bot to a user or channel.')
    .addStringOption(o => o.setName('message').setDescription('Plain-text message to send.').setRequired(true).setMinLength(1).setMaxLength(2000))
    .addUserOption(o => o.setName('user').setDescription('Optional user to DM. If selected, this takes priority over channel.'))
    .addChannelOption(o => o
      .setName('channel')
      .setDescription('Optional channel to send to. Defaults to the current channel.')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Show detailed information about a server role.')
    .addRoleOption(o => o.setName('role').setDescription('Role to inspect.').setRequired(true)),

  new SlashCommandBuilder()
    .setName('memberinfo')
    .setDescription('Show detailed information about a server member.')
    .addUserOption(o => o.setName('member').setDescription('Member to inspect. Defaults to yourself.')),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show detailed information about this server.'),

  new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('Show live server totals and recorded join/leave statistics.'),

  new SlashCommandBuilder()
    .setName('servergraph')
    .setDescription('Generate a joins vs leaves graph from recorded server activity.')
    .addStringOption(o => o
      .setName('range')
      .setDescription('How many days to graph. Defaults to 7 days.')
      .addChoices(
        { name: '7 days', value: '7d' },
        { name: '14 days', value: '14d' },
        { name: '30 days', value: '30d' },
      )),

  new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Show detailed information about a channel.')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to inspect. Defaults to this channel.')),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show a member avatar in full size.')
    .addUserOption(o => o.setName('member').setDescription('Member whose avatar to show. Defaults to yourself.')),

  new SlashCommandBuilder()
    .setName('permissions')
    .setDescription("Show a member's effective server permissions.")
    .addUserOption(o => o.setName('member').setDescription('Member to inspect. Defaults to yourself.')),

  new SlashCommandBuilder()
    .setName('rolelist')
    .setDescription('List the server roles and their IDs.'),

  new SlashCommandBuilder()
    .setName('servericon')
    .setDescription('Show the server icon in full size.'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Show the bot gateway latency and uptime.'),

  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Show information and uptime for this moderation bot.'),

  new SlashCommandBuilder()
    .setName('dmall')
    .setDescription('DM a plain-text announcement to all members or one role.')
    .addStringOption(o => o.setName('message').setDescription('Plain-text message to send.').setRequired(true).setMinLength(1).setMaxLength(2000))
    .addRoleOption(o => o.setName('role').setDescription('Optional role. Only members with this role will be DMed.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`[READY] Logged in as ${client.user.tag}`);

  startStatusRotator();

  try {
    const rest = new REST({ version: '10' }).setToken(CONFIG.token);
    await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.guildId), { body: commands });
    console.log(`[COMMANDS] Registered ${commands.length} guild commands.`);
  } catch (error) {
    console.error('[COMMANDS] Registration failed:', error);
  }

  if (!state.nextBaptismAt) {
    state.nextBaptismAt = Date.now() + THREE_DAYS_MS;
    saveState();
  }

  console.log(`[BAPTISM] Next scheduled clear: ${new Date(state.nextBaptismAt).toISOString()}`);

  setInterval(checkBaptismSchedule, 60_000).unref();
  setInterval(checkTempBans, 60_000).unref();
  await checkBaptismSchedule();
  await checkTempBans();
});

function startStatusRotator() {
  let index = 0;

  const rotate = () => {
    if (!client.user) return;
    const guild = client.guilds.cache.get(CONFIG.guildId);
    const status = STATUS_ROTATION[index % STATUS_ROTATION.length];
    index += 1;

    try {
      client.user.setPresence({
        status: 'online',
        activities: [{
          name: status.text(guild),
          type: status.type,
        }],
      });
    } catch (error) {
      console.error('[STATUS] Failed to update rotating status:', error);
    }
  };

  rotate();
  setInterval(rotate, STATUS_ROTATION_INTERVAL_MS).unref();
}

client.on('channelCreate', async channel => {
  if (!state.lockdown?.active) return;
  if (channel.guild?.id !== CONFIG.guildId) return;
  if (channel.parentId !== CONFIG.lockdownCategoryId) return;
  if (!('permissionOverwrites' in channel)) return;

  try {
    if (!state.lockdown.channels[channel.id]) {
      state.lockdown.channels[channel.id] = null;
      saveState();
    }
    await channel.permissionOverwrites.edit(CONFIG.customerRoleId, { ViewChannel: false }, { reason: 'Emergency category lockdown is active' });
  } catch (error) {
    console.error(`[LOCKDOWN] Failed to apply lockdown to new channel ${channel.id}:`, error);
  }
});


client.on('messageCreate', async message => {
  if (message.author?.bot) return;

  // Direct messages do not belong to a guild. Log them separately instead of
  // passing them through the guild automod/censor pipeline.
  if (!message.guild) {
    await logIncomingDM(message).catch(error => console.error('[DM LOG] Incoming DM log failed:', error));
    return;
  }

  await moderateMessage(message).catch(error => console.error('[AUTOMOD] messageCreate failed:', error));
});

client.on('messageUpdate', async (_oldMessage, newMessage) => {
  if (newMessage.partial) await newMessage.fetch().catch(() => null);
  await moderateMessage(newMessage).catch(error => console.error('[AUTOMOD] messageUpdate failed:', error));
});

client.on('guildMemberAdd', async member => {
  if (member.guild.id !== CONFIG.guildId || member.user.bot) return;
  try {
    registerMemberActivity('join', member.id);
    registerJoin(member);
    const assessment = evaluateAltRisk(member);
    if (assessment.score >= 25) await sendAltRiskLog(member, assessment, assessment.score >= CONFIG.altAlertThreshold);
  } catch (error) {
    console.error('[ALT] Join assessment failed:', error);
  }
});

client.on('guildMemberRemove', member => {
  if (member.guild.id !== CONFIG.guildId || member.user?.bot) return;
  try {
    registerMemberActivity('leave', member.id);
  } catch (error) {
    console.error('[ANALYTICS] Failed to record member leave:', error);
  }
});

client.on('guildBanAdd', async ban => {
  if (ban.guild.id !== CONFIG.guildId) return;
  try {
    const cachedMember = ban.guild.members.cache.get(ban.user.id);
    recordRecentBan(ban.user, cachedMember?.displayName || null);
  } catch (error) {
    console.error('[ALT] Failed to record guild ban:', error);
  }
});

client.on('guildBanRemove', async ban => {
  if (ban.guild.id !== CONFIG.guildId) return;
  if (state.tempBans?.[ban.user.id]) {
    delete state.tempBans[ban.user.id];
    saveState();
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild() || interaction.guildId !== CONFIG.guildId) return;

  try {
    switch (interaction.commandName) {
      case 'lockdown': return handleLockdown(interaction);
      case 'unlockdown': return handleUnlockdown(interaction);
      case 'baptize': return handleBaptize(interaction);
      case 'purge': return handlePurge(interaction);
      case 'warn': return handleWarn(interaction);
      case 'warnings': return handleWarnings(interaction);
      case 'clearwarnings': return handleClearWarnings(interaction);
      case 'timeout': return handleTimeout(interaction);
      case 'untimeout': return handleUntimeout(interaction);
      case 'kick': return handleKick(interaction);
      case 'ban': return handleBan(interaction);
      case 'unban': return handleUnban(interaction);
      case 'tempban': return handleTempBan(interaction);
      case 'softban': return handleSoftBan(interaction);
      case 'baninfo': return handleBanInfo(interaction);
      case 'banlist': return handleBanList(interaction);
      case 'altcheck': return handleAltCheck(interaction);
      case 'censorlist': return handleCensorList(interaction);
      case 'censoradd': return handleCensorAdd(interaction);
      case 'censorremove': return handleCensorRemove(interaction);
      case 'slowmode': return handleSlowmode(interaction);
      case 'lockchannel': return handleLockChannel(interaction);
      case 'unlockchannel': return handleUnlockChannel(interaction);
      case 'nick': return handleNick(interaction);
      case 'talk': return handleTalk(interaction);
      case 'roleinfo': return handleRoleInfo(interaction);
      case 'memberinfo': return handleMemberInfo(interaction);
      case 'serverinfo': return handleServerInfo(interaction);
      case 'serverstats': return handleServerStats(interaction);
      case 'servergraph': return handleServerGraph(interaction);
      case 'channelinfo': return handleChannelInfo(interaction);
      case 'avatar': return handleAvatar(interaction);
      case 'permissions': return handlePermissions(interaction);
      case 'rolelist': return handleRoleList(interaction);
      case 'servericon': return handleServerIcon(interaction);
      case 'ping': return handlePing(interaction);
      case 'botinfo': return handleBotInfo(interaction);
      case 'dmall': return handleDmAll(interaction);
      default: return;
    }
  } catch (error) {
    console.error(`[INTERACTION] ${interaction.commandName} failed:`, error);
    const payload = v2Payload({
      title: 'Command Failed',
      description: `Something went wrong while running this command.\n\n\`${truncate(error?.message || String(error), 700)}\``,
      accentColor: 0xED4245,
      ephemeral: true,
    });

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(stripEphemeralFlag(payload)).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

async function handleLockdown(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
  const reason = interaction.options.getString('reason') || 'Emergency lockdown';

  await interaction.reply(v2Payload({
    title: 'Lockdown Starting',
    description: `Removing the Customer role's access to the configured category and its channels. ${EMOJIS.smileyTom}`,
    accentColor: 0xFEE75C,
    ephemeral: true,
  }));

  if (state.lockdown?.active) {
    return interaction.editReply(v2Edit({
      title: 'Already Locked Down',
      description: 'The emergency category lockdown is already active.',
      accentColor: 0xFEE75C,
    }));
  }

  const guild = await client.guilds.fetch(CONFIG.guildId);
  const category = await guild.channels.fetch(CONFIG.lockdownCategoryId);
  if (!category || category.type !== ChannelType.GuildCategory) throw new Error('Configured lockdown category could not be found.');

  const snapshot = {
    active: true,
    startedAt: Date.now(),
    startedBy: interaction.user.id,
    reason,
    category: snapshotOverwrite(category, CONFIG.customerRoleId),
    channels: {},
  };

  const children = guild.channels.cache.filter(ch => ch.parentId === CONFIG.lockdownCategoryId);
  for (const channel of children.values()) {
    if (!('permissionOverwrites' in channel)) continue;
    snapshot.channels[channel.id] = snapshotOverwrite(channel, CONFIG.customerRoleId);
  }

  state.lockdown = snapshot;
  saveState();

  await category.permissionOverwrites.edit(CONFIG.customerRoleId, { ViewChannel: false }, { reason: `Emergency lockdown: ${reason}` });

  let changed = 0;
  for (const channel of children.values()) {
    if (!('permissionOverwrites' in channel)) continue;
    await channel.permissionOverwrites.edit(CONFIG.customerRoleId, { ViewChannel: false }, { reason: `Emergency lockdown: ${reason}` });
    changed++;
  }

  await logAction({
    title: 'Emergency Lockdown Enabled',
    description: `Customer access was removed from the emergency category and **${changed}** child channel(s).`,
    moderator: interaction.user,
    reason,
    extra: `Category: <#${CONFIG.lockdownCategoryId}>`,
    accentColor: 0xED4245,
  });

  await interaction.editReply(v2Edit({
    title: 'Lockdown Enabled',
    description: `Customer access is now hidden across the category and **${changed}** current channel(s).\n\nUse \`/unlockdown\` to restore the exact saved overwrites.`,
    accentColor: 0xED4245,
  }));
}

async function handleUnlockdown(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
  const reason = interaction.options.getString('reason') || 'Emergency resolved';

  await interaction.reply(v2Payload({
    title: 'Restoring Access',
    description: 'Restoring the Customer role overwrite state saved before lockdown.',
    accentColor: 0xFEE75C,
    ephemeral: true,
  }));

  if (!state.lockdown?.active) {
    return interaction.editReply(v2Edit({
      title: 'No Active Lockdown',
      description: 'There is no saved emergency lockdown to restore.',
      accentColor: 0xFEE75C,
    }));
  }

  const guild = await client.guilds.fetch(CONFIG.guildId);
  const snapshot = structuredClone(state.lockdown);
  let restored = 0;
  let missing = 0;

  const category = await guild.channels.fetch(CONFIG.lockdownCategoryId).catch(() => null);
  if (category && 'permissionOverwrites' in category) {
    await restoreOverwrite(category, CONFIG.customerRoleId, snapshot.category, `Ending emergency lockdown: ${reason}`);
  }

  for (const [channelId, overwrite] of Object.entries(snapshot.channels || {})) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !('permissionOverwrites' in channel)) {
      missing++;
      continue;
    }
    await restoreOverwrite(channel, CONFIG.customerRoleId, overwrite, `Ending emergency lockdown: ${reason}`);
    restored++;
  }

  state.lockdown = { active: false, lastEndedAt: Date.now(), lastEndedBy: interaction.user.id, lastReason: reason, channels: {} };
  saveState();

  await logAction({
    title: 'Emergency Lockdown Disabled',
    description: `Saved Customer-role permissions were restored on **${restored}** channel(s).${missing ? ` **${missing}** deleted/missing channel(s) were skipped.` : ''}`,
    moderator: interaction.user,
    reason,
    extra: `Category: <#${CONFIG.lockdownCategoryId}>`,
    accentColor: 0x57F287,
  });

  await interaction.editReply(v2Edit({
    title: 'Lockdown Disabled',
    description: `Customer access has been restored from the saved pre-lockdown state on **${restored}** channel(s).${missing ? `\n${missing} missing/deleted channel(s) were skipped.` : ''}`,
    accentColor: 0x57F287,
  }));
}

async function handleBaptize(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages))) return;
  const reason = interaction.options.getString('reason') || 'Manual chat baptism';

  await interaction.reply(v2Payload({
    title: 'Baptizing Chat',
    description: `Clearing <#${CONFIG.baptismChannelId}> while preserving pinned messages.`,
    accentColor: 0x5865F2,
    ephemeral: true,
  }));

  const result = await runBaptism({ mode: 'Manual', moderator: interaction.user, reason });
  state.nextBaptismAt = Date.now() + THREE_DAYS_MS;
  saveState();

  await interaction.editReply(v2Edit({
    title: 'Chat Baptized',
    description: `Deleted **${result.deleted}** message(s) and posted the baptism message.\n\nNext automatic baptism: <t:${Math.floor(state.nextBaptismAt / 1000)}:R>.`,
    accentColor: 0x57F287,
  }));
}

async function handlePurge(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages))) return;
  if (!interaction.channel?.isTextBased() || !('messages' in interaction.channel)) {
    return interaction.reply(v2Payload({ title: 'Unsupported Channel', description: 'This command needs a normal text-based channel.', accentColor: 0xED4245, ephemeral: true }));
  }

  const amount = interaction.options.getInteger('amount', true);
  const targetUser = interaction.options.getUser('member');
  const reason = interaction.options.getString('reason') || 'Message cleanup';

  await interaction.reply(v2Payload({
    title: 'Purging Messages',
    description: targetUser ? `Deleting up to **${amount}** recent message(s) from ${targetUser}.` : `Deleting up to **${amount}** recent message(s).`,
    accentColor: 0xFEE75C,
    ephemeral: true,
  }));

  const deleted = await purgeRecent(interaction.channel, amount, targetUser?.id);

  await logAction({
    title: 'Messages Purged',
    description: `Deleted **${deleted}** message(s) in ${interaction.channel}.`,
    moderator: interaction.user,
    reason,
    target: targetUser,
    accentColor: 0x5865F2,
  });

  await interaction.editReply(v2Edit({
    title: 'Purge Complete',
    description: `Deleted **${deleted}** message(s).`,
    accentColor: 0x57F287,
  }));
}

async function handleWarn(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers))) return;
  const user = interaction.options.getUser('member', true);
  const reason = interaction.options.getString('reason', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');
  if (!canActOn(interaction.member, member, interaction.guild)) return fail(interaction, 'Role Hierarchy', 'You cannot moderate that member because their highest role is equal to or above yours.');

  const warnings = state.warnings[user.id] || [];
  warnings.push({ id: makeId(), reason, moderatorId: interaction.user.id, createdAt: Date.now() });
  state.warnings[user.id] = warnings;
  saveState();

  const dmSent = await sendModerationDM(user, {
    guildName: interaction.guild.name,
    action: 'Warning',
    reason,
    moderator: interaction.user,
    details: `Warnings on record: **${warnings.length}**`,
  });

  await logAction({ title: 'Member Warned', description: `${user} now has **${warnings.length}** warning(s) on record.`, moderator: interaction.user, target: user, reason, extra: moderationDmStatus(dmSent), accentColor: 0xFEE75C });
  return interaction.reply(v2Payload({ title: 'Warning Added', description: `${user} now has **${warnings.length}** warning(s).\n\n${moderationDmStatus(dmSent)}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleWarnings(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers))) return;
  const user = interaction.options.getUser('member', true);
  const warnings = state.warnings[user.id] || [];
  const body = warnings.length
    ? warnings.slice(-10).map((w, i) => `**${warnings.length - warnings.slice(-10).length + i + 1}.** ${truncate(escapeMassMentions(w.reason), 180)}\n<t:${Math.floor(w.createdAt / 1000)}:f> • <@${w.moderatorId}> • \`${w.id}\``).join('\n\n')
    : 'No saved warnings for this member.';

  return interaction.reply(v2Payload({
    title: `Warnings — ${user.username}`,
    description: `${body}${warnings.length > 10 ? `\n\nShowing the newest 10 of ${warnings.length}.` : ''}`,
    accentColor: warnings.length ? 0xFEE75C : 0x57F287,
    ephemeral: true,
  }));
}

async function handleClearWarnings(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers))) return;
  const user = interaction.options.getUser('member', true);
  const reason = interaction.options.getString('reason') || 'Warnings cleared';
  const count = (state.warnings[user.id] || []).length;
  state.warnings[user.id] = [];
  saveState();

  await logAction({ title: 'Warnings Cleared', description: `Cleared **${count}** warning(s) from ${user}.`, moderator: interaction.user, target: user, reason, accentColor: 0x57F287 });
  return interaction.reply(v2Payload({ title: 'Warnings Cleared', description: `Removed **${count}** saved warning(s) from ${user}.`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleTimeout(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers))) return;
  const user = interaction.options.getUser('member', true);
  const durationText = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason', true);
  const duration = parseDuration(durationText);
  if (!duration || duration > 28 * 24 * 60 * 60 * 1000) return fail(interaction, 'Invalid Duration', 'Use something like `10m`, `2h`, `1d`, or `1w`. Maximum timeout is 28 days.');

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');
  if (!canActOn(interaction.member, member, interaction.guild)) return fail(interaction, 'Role Hierarchy', 'You cannot timeout that member because their highest role is equal to or above yours.');
  if (!member.moderatable) return fail(interaction, 'Cannot Timeout', 'The bot cannot timeout this member. Check the bot role hierarchy and permissions.');

  const dmSent = await sendModerationDM(user, {
    guildName: interaction.guild.name,
    action: 'Timeout',
    reason,
    moderator: interaction.user,
    duration: formatDuration(duration),
  });
  await member.timeout(duration, reason);
  await logAction({ title: 'Member Timed Out', description: `${user} was timed out for **${formatDuration(duration)}**.`, moderator: interaction.user, target: user, reason, extra: moderationDmStatus(dmSent), accentColor: 0xFEE75C });
  return interaction.reply(v2Payload({ title: 'Member Timed Out', description: `${user} has been timed out for **${formatDuration(duration)}**.\n\n${moderationDmStatus(dmSent)}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleUntimeout(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers))) return;
  const user = interaction.options.getUser('member', true);
  const reason = interaction.options.getString('reason') || 'Timeout removed';
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');
  if (!member.moderatable) return fail(interaction, 'Cannot Remove Timeout', 'The bot cannot modify this member. Check the bot role hierarchy.');

  await member.timeout(null, reason);
  const dmSent = await sendModerationDM(user, {
    guildName: interaction.guild.name,
    action: 'Timeout Removed',
    reason,
    moderator: interaction.user,
  });
  await logAction({ title: 'Timeout Removed', description: `${user}'s timeout was removed.`, moderator: interaction.user, target: user, reason, extra: moderationDmStatus(dmSent), accentColor: 0x57F287 });
  return interaction.reply(v2Payload({ title: 'Timeout Removed', description: `${user}'s timeout has been removed.\n\n${moderationDmStatus(dmSent)}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleKick(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.KickMembers))) return;
  const user = interaction.options.getUser('member', true);
  const reason = interaction.options.getString('reason', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');
  if (!canActOn(interaction.member, member, interaction.guild)) return fail(interaction, 'Role Hierarchy', 'You cannot kick that member because their highest role is equal to or above yours.');
  if (!member.kickable) return fail(interaction, 'Cannot Kick', 'The bot cannot kick this member. Check the bot role hierarchy and permissions.');

  const dmSent = await sendModerationDM(user, {
    guildName: interaction.guild.name,
    action: 'Kick',
    reason,
    moderator: interaction.user,
  });
  await member.kick(reason);
  await logAction({ title: 'Member Kicked', description: `${user} was kicked from the server.`, moderator: interaction.user, target: user, reason, extra: moderationDmStatus(dmSent), accentColor: 0xED4245 });
  return interaction.reply(v2Payload({ title: 'Member Kicked', description: `${user.tag} was kicked.\n\n${moderationDmStatus(dmSent)}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleBan(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.BanMembers))) return;
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);
  const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (member) {
    if (!canActOn(interaction.member, member, interaction.guild)) return fail(interaction, 'Role Hierarchy', 'You cannot ban that member because their highest role is equal to or above yours.');
    if (!member.bannable) return fail(interaction, 'Cannot Ban', 'The bot cannot ban this member. Check the bot role hierarchy and permissions.');
  }

  const dmSent = await sendModerationDM(user, {
    guildName: interaction.guild.name,
    action: 'Ban',
    reason,
    moderator: interaction.user,
    duration: 'Permanent',
  });
  await interaction.guild.members.ban(user.id, { deleteMessageSeconds: deleteDays * 86400, reason });
  delete state.tempBans[user.id];
  recordRecentBan(user, member?.displayName || null);
  saveState();
  await logAction({ title: 'User Banned', description: `${user} was banned.${deleteDays ? ` Recent messages from the last **${deleteDays}** day(s) were requested for deletion.` : ''}`, moderator: interaction.user, target: user, reason, extra: moderationDmStatus(dmSent), accentColor: 0xED4245 });
  return interaction.reply(v2Payload({ title: 'User Banned', description: `${user.tag} was banned.\n\n${moderationDmStatus(dmSent)}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleUnban(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.BanMembers))) return;
  const userId = interaction.options.getString('user_id', true);
  const reason = interaction.options.getString('reason') || 'Unbanned by moderator';
  if (!/^\d{17,20}$/.test(userId)) return fail(interaction, 'Invalid User ID', 'Enter a valid Discord user ID.');

  const user = await interaction.guild.members.unban(userId, reason).catch(error => {
    if (error?.code === 10026) return null;
    throw error;
  });
  if (!user) return fail(interaction, 'Not Banned', 'That user is not currently banned.');
  delete state.tempBans[userId];
  saveState();

  await logAction({ title: 'User Unbanned', description: `<@${userId}> (\`${userId}\`) was unbanned.`, moderator: interaction.user, reason, accentColor: 0x57F287 });
  return interaction.reply(v2Payload({ title: 'User Unbanned', description: `Unbanned **${user.tag}**.`, accentColor: 0x57F287, ephemeral: true }));
}


async function handleTempBan(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.BanMembers))) return;
  const user = interaction.options.getUser('user', true);
  const durationText = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason', true);
  const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
  const duration = parseDuration(durationText);
  const max = 365 * 24 * 60 * 60 * 1000;
  if (!duration || duration > max) return fail(interaction, 'Invalid Duration', 'Use something like `1h`, `3d`, or `2w`. Maximum temporary ban is 365 days.');

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member) {
    if (!canActOn(interaction.member, member, interaction.guild)) return fail(interaction, 'Role Hierarchy', 'You cannot ban that member because their highest role is equal to or above yours.');
    if (!member.bannable) return fail(interaction, 'Cannot Ban', 'The bot cannot ban this member. Check the bot role hierarchy and permissions.');
  }

  const unbanAt = Date.now() + duration;
  const dmSent = await sendModerationDM(user, {
    guildName: interaction.guild.name,
    action: 'Temporary Ban',
    reason,
    moderator: interaction.user,
    duration: formatDuration(duration),
    details: `Expires <t:${Math.floor(unbanAt / 1000)}:F> (<t:${Math.floor(unbanAt / 1000)}:R>)`,
  });

  await interaction.guild.members.ban(user.id, { deleteMessageSeconds: deleteDays * 86400, reason: `Temporary ban (${formatDuration(duration)}): ${reason}` });
  state.tempBans[user.id] = { unbanAt, reason, moderatorId: interaction.user.id, createdAt: Date.now() };
  recordRecentBan(user, member?.displayName || null);
  saveState();

  await logAction({
    title: 'Temporary Ban Added',
    description: `${user} was banned for **${formatDuration(duration)}** and will be automatically unbanned <t:${Math.floor(unbanAt / 1000)}:R>.`,
    moderator: interaction.user,
    target: user,
    reason,
    extra: `${deleteDays ? `Message deletion requested: ${deleteDays} day(s)\n` : ''}${moderationDmStatus(dmSent)}`,
    accentColor: 0xED4245,
  });
  return interaction.reply(v2Payload({ title: 'Temporary Ban Added', description: `${user.tag} was banned for **${formatDuration(duration)}**.\n\n${moderationDmStatus(dmSent)}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleSoftBan(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.BanMembers))) return;
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);
  const deleteDays = interaction.options.getInteger('delete_days') ?? 7;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (member) {
    if (!canActOn(interaction.member, member, interaction.guild)) return fail(interaction, 'Role Hierarchy', 'You cannot softban that member because their highest role is equal to or above yours.');
    if (!member.bannable) return fail(interaction, 'Cannot Softban', 'The bot cannot ban this member. Check role hierarchy and permissions.');
  }

  const dmSent = await sendModerationDM(user, {
    guildName: interaction.guild.name,
    action: 'Softban',
    reason,
    moderator: interaction.user,
    details: 'You may rejoin the server unless staff has told you otherwise.',
  });
  await interaction.guild.members.ban(user.id, { deleteMessageSeconds: deleteDays * 86400, reason: `Softban: ${reason}` });
  recordRecentBan(user, member?.displayName || null);
  await interaction.guild.members.unban(user.id, `Softban completed: ${reason}`);
  delete state.tempBans[user.id];
  saveState();

  await logAction({ title: 'User Softbanned', description: `${user} was banned and immediately unbanned. Up to **${deleteDays}** day(s) of recent messages were requested for deletion.`, moderator: interaction.user, target: user, reason, extra: moderationDmStatus(dmSent), accentColor: 0xED4245 });
  return interaction.reply(v2Payload({ title: 'Softban Complete', description: `${user.tag} was softbanned and may now rejoin.\n\n${moderationDmStatus(dmSent)}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleBanInfo(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.BanMembers))) return;
  const userId = interaction.options.getString('user_id', true);
  if (!/^\d{17,20}$/.test(userId)) return fail(interaction, 'Invalid User ID', 'Enter a valid Discord user ID.');

  const ban = await interaction.guild.bans.fetch(userId).catch(error => {
    if (error?.code === 10026) return null;
    throw error;
  });
  if (!ban) return fail(interaction, 'Not Banned', 'That user is not currently banned.');

  const temp = state.tempBans[userId];
  const tempText = temp
    ? `\n\n**Temporary Ban**\nExpires <t:${Math.floor(temp.unbanAt / 1000)}:F> (<t:${Math.floor(temp.unbanAt / 1000)}:R>)\nIssued by <@${temp.moderatorId}>`
    : '\n\n**Temporary Ban**\nNo - this is currently treated as a permanent ban.';

  return interaction.reply(v2Payload({
    title: `Ban Info - ${ban.user.username}`,
    description: `**User**\n${ban.user} (\`${ban.user.id}\`)\n\n**Discord Ban Reason**\n${escapeMassMentions(ban.reason || 'No reason stored by Discord.')}${tempText}`,
    accentColor: 0x5865F2,
    ephemeral: true,
  }));
}

async function handleBanList(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.BanMembers))) return;
  const bans = await interaction.guild.bans.fetch();
  if (!bans.size) return interaction.reply(v2Payload({ title: 'Ban List', description: 'There are currently no banned users.', accentColor: 0x57F287, ephemeral: true }));

  const entries = [...bans.values()].slice(0, 20).map((ban, index) => {
    const temp = state.tempBans[ban.user.id];
    return `**${index + 1}. ${escapeMassMentions(ban.user.tag)}** - \`${ban.user.id}\`${temp ? ` - temp until <t:${Math.floor(temp.unbanAt / 1000)}:R>` : ''}\n${truncate(escapeMassMentions(ban.reason || 'No reason'), 130)}`;
  });
  return interaction.reply(v2Payload({
    title: 'Ban List',
    description: `${entries.join('\n\n')}${bans.size > 20 ? `\n\nShowing 20 of ${bans.size} bans.` : `\n\nTotal bans: **${bans.size}**`}`,
    accentColor: 0x5865F2,
    ephemeral: true,
  }));
}

async function handleAltCheck(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers))) return;
  const user = interaction.options.getUser('member', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');
  const assessment = evaluateAltRisk(member);
  const label = altRiskLabel(assessment.score);
  const reasons = assessment.reasons.length ? assessment.reasons.map(r => `- ${r}`).join('\n') : '- No notable risk signals detected.';

  return interaction.reply(v2Payload({
    title: `Alt Risk Check - ${label}`,
    description: `${member} (\`${member.id}\`)\n\n**Risk Score**\n**${assessment.score}/100**\n\n**Account Age**\n${formatDurationLoose(Date.now() - member.user.createdTimestamp)}\n\n**Signals**\n${reasons}\n\n-# This is a heuristic risk check, not proof that someone is an alt. Discord bots cannot see a user's IP address or device identity.`,
    accentColor: altRiskColor(assessment.score),
    ephemeral: true,
  }));
}

async function handleCensorList(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages))) return;
  const terms = state.censoredTerms || [];
  const body = terms.length ? terms.map((term, i) => `**${i + 1}.** \`${escapeCode(term)}\``).join('\n') : 'No censored words or phrases have been added yet.';
  return interaction.reply(v2Payload({ title: 'Censor List', description: truncate(body, 3500), accentColor: terms.length ? 0x5865F2 : 0x57F287, ephemeral: true }));
}

async function handleCensorAdd(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages))) return;
  const raw = interaction.options.getString('word', true).trim();
  const reason = interaction.options.getString('reason') || 'Censor trigger added';
  const requested = parseCensorWords(raw);
  if (!requested.length) return fail(interaction, 'Invalid Censor', 'Enter at least one usable trigger word.');

  const existingKeys = new Set((state.censoredTerms || []).map(normalizeCensorTerm).filter(Boolean));
  const added = [];
  const already = [];
  for (const word of requested) {
    const key = normalizeCensorTerm(word);
    if (existingKeys.has(key)) {
      already.push(word);
      continue;
    }
    state.censoredTerms.push(word);
    existingKeys.add(key);
    added.push(word);
  }

  state.censoredTerms = normalizeStoredCensorTerms(state.censoredTerms);
  if (added.length) saveState();

  if (!added.length) {
    return fail(interaction, 'Already Censored', `All of those trigger words are already blocked: ${already.map(w => `\`${escapeCode(w)}\``).join(', ')}`);
  }

  const addedText = added.map(w => `\`${escapeCode(w)}\``).join(', ');
  const skippedText = already.length ? `\n\nAlready blocked: ${already.map(w => `\`${escapeCode(w)}\``).join(', ')}` : '';
  await logAction({ title: 'Censor Added', description: `Added ${addedText} to the server-wide censor.`, moderator: interaction.user, reason, accentColor: 0x5865F2 });
  return interaction.reply(v2Payload({ title: 'Censor Added', description: `Now blocking **${added.length}** trigger word${added.length === 1 ? '' : 's'} server-wide:\n${added.map(w => `- \`${escapeCode(w)}\``).join('\n')}${skippedText}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleCensorRemove(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages))) return;
  const raw = interaction.options.getString('word', true).trim();
  const reason = interaction.options.getString('reason') || 'Censor trigger removed';
  const requested = parseCensorWords(raw);
  if (!requested.length) return fail(interaction, 'Invalid Censor', 'Enter at least one trigger word to remove.');

  const removeKeys = new Set(requested.map(normalizeCensorTerm).filter(Boolean));
  const removed = [];
  const kept = [];
  for (const term of state.censoredTerms || []) {
    if (removeKeys.has(normalizeCensorTerm(term))) removed.push(term);
    else kept.push(term);
  }

  if (!removed.length) return fail(interaction, 'Not Censored', 'None of those trigger words are currently on the censor list.');
  state.censoredTerms = normalizeStoredCensorTerms(kept);
  saveState();

  const removedKeys = new Set(removed.map(normalizeCensorTerm));
  const notFound = requested.filter(w => !removedKeys.has(normalizeCensorTerm(w)));
  const removedText = removed.map(w => `\`${escapeCode(w)}\``).join(', ');
  await logAction({ title: 'Censor Removed', description: `Removed ${removedText} from the server-wide censor.`, moderator: interaction.user, reason, accentColor: 0x57F287 });
  return interaction.reply(v2Payload({ title: 'Censor Removed', description: `Removed **${removed.length}** trigger word${removed.length === 1 ? '' : 's'}:\n${removed.map(w => `- \`${escapeCode(w)}\``).join('\n')}${notFound.length ? `\n\nNot found: ${notFound.map(w => `\`${escapeCode(w)}\``).join(', ')}` : ''}`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleSlowmode(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
  if (!interaction.channel || !('setRateLimitPerUser' in interaction.channel)) return fail(interaction, 'Unsupported Channel', 'Slowmode is not supported in this channel.');

  const seconds = interaction.options.getInteger('seconds', true);
  const reason = interaction.options.getString('reason') || 'Slowmode changed';
  await interaction.channel.setRateLimitPerUser(seconds, reason);

  await logAction({ title: 'Slowmode Changed', description: `${interaction.channel} slowmode is now **${seconds === 0 ? 'Off' : `${seconds}s`}**.`, moderator: interaction.user, reason, accentColor: 0x5865F2 });
  return interaction.reply(v2Payload({ title: 'Slowmode Updated', description: seconds === 0 ? 'Slowmode is now disabled.' : `Slowmode is now **${seconds} seconds**.`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleLockChannel(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
  const channel = interaction.channel;
  if (!channel || !('permissionOverwrites' in channel)) return fail(interaction, 'Unsupported Channel', 'This channel cannot be locked this way.');
  const reason = interaction.options.getString('reason') || 'Channel locked';

  if (state.channelLocks[channel.id]?.active) return fail(interaction, 'Already Locked', 'This channel already has a saved lock state.');

  const everyoneId = interaction.guild.roles.everyone.id;
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
  state.channelLocks[channel.id] = {
    active: true,
    previousSendMessages: permissionTriState(overwrite, PermissionFlagsBits.SendMessages),
    lockedAt: Date.now(),
    lockedBy: interaction.user.id,
  };
  saveState();

  await channel.permissionOverwrites.edit(everyoneId, { SendMessages: false }, { reason });
  await logAction({ title: 'Channel Locked', description: `${channel} was locked for @everyone.`, moderator: interaction.user, reason, accentColor: 0xED4245 });
  return interaction.reply(v2Payload({ title: 'Channel Locked', description: `${channel} is now locked for @everyone.`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleUnlockChannel(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
  const channel = interaction.channel;
  if (!channel || !('permissionOverwrites' in channel)) return fail(interaction, 'Unsupported Channel', 'This channel cannot be unlocked this way.');
  const reason = interaction.options.getString('reason') || 'Channel unlocked';
  const lock = state.channelLocks[channel.id];
  if (!lock?.active) return fail(interaction, 'No Saved Lock', 'This channel was not locked through this bot, so there is no previous state to restore.');

  const everyoneId = interaction.guild.roles.everyone.id;
  await channel.permissionOverwrites.edit(everyoneId, { SendMessages: lock.previousSendMessages }, { reason });
  delete state.channelLocks[channel.id];
  saveState();

  await logAction({ title: 'Channel Unlocked', description: `${channel}'s previous @everyone Send Messages state was restored.`, moderator: interaction.user, reason, accentColor: 0x57F287 });
  return interaction.reply(v2Payload({ title: 'Channel Unlocked', description: `${channel}'s previous send permission has been restored.`, accentColor: 0x57F287, ephemeral: true }));
}

async function handleNick(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageNicknames))) return;
  const user = interaction.options.getUser('member', true);
  const nickname = interaction.options.getString('nickname') || null;
  const reason = interaction.options.getString('reason') || 'Nickname changed';
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');
  if (!canActOn(interaction.member, member, interaction.guild)) return fail(interaction, 'Role Hierarchy', 'You cannot edit that member because their highest role is equal to or above yours.');
  if (!member.manageable) return fail(interaction, 'Cannot Edit Nickname', 'The bot cannot manage this member. Check role hierarchy.');

  const before = member.nickname || member.user.username;
  await member.setNickname(nickname, reason);
  const after = nickname || member.user.username;

  await logAction({ title: 'Nickname Changed', description: `${user}: **${escapeMassMentions(before)}** → **${escapeMassMentions(after)}**`, moderator: interaction.user, target: user, reason, accentColor: 0x5865F2 });
  return interaction.reply(v2Payload({ title: 'Nickname Updated', description: nickname ? `${user}'s nickname is now **${escapeMassMentions(nickname)}**.` : `${user}'s nickname was reset.`, accentColor: 0x57F287, ephemeral: true }));
}


async function moderateMessage(message) {
  if (!message?.guild || message.guild.id !== CONFIG.guildId) return;
  if (!message.author || message.author.bot || !message.content) return;
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  // The censor applies to every non-bot member, including moderators/admins.
  // Staff permissions only bypass the category Discord-link filter.
  const censorMatch = findCensorMatch(message.content);
  const channelPerms = message.channel?.permissionsFor?.(member);
  const staffLinkBypass = member.permissions.has(PermissionFlagsBits.Administrator) || channelPerms?.has(PermissionFlagsBits.ManageMessages);
  const discordLink = !staffLinkBypass && channelIsInLockdownCategory(message.channel) && containsDiscordLink(message.content);
  if (!censorMatch && !discordLink) return;

  const reason = censorMatch ? `Censored word/phrase: ${censorMatch}` : 'Discord links are blocked in this category';
  const type = censorMatch ? 'Censor Filter' : 'Discord Link Filter';
  const channelMention = `<#${message.channelId}>`;
  await message.delete().catch(() => {});

  let autoWarning = null;
  if (censorMatch) autoWarning = addAutoCensorWarning(message.author.id, censorMatch);

  await message.author.send(v2Payload({
    title: 'Message Removed',
    description: censorMatch
      ? `Your message in **${message.guild.name}** was removed because it contained a censored word or phrase.\n\nBlocked entry: \`${escapeCode(censorMatch)}\`${autoWarning?.added ? `\n\nA warning was added to your moderation history. You now have **${autoWarning.count}** warning(s).` : autoWarning?.cooldown ? '\n\nThe message was still removed, but another warning was not added because your censor-warning cooldown is active.' : ''}`
      : `Your message in **${message.guild.name}** was removed because Discord links are not allowed in that category.`,
    accentColor: 0xED4245,
  })).catch(() => {});

  await logAction({
    title: type,
    description: `${message.author} had a message removed in ${channelMention}.`,
    moderator: client.user,
    target: message.author,
    reason,
    extra: `Message preview: ${truncate(escapeMassMentions(message.content), 450)}${autoWarning?.added ? `\nAuto-warning added: ${autoWarning.count} total warning(s).` : autoWarning?.cooldown ? '\nAuto-warning skipped: 60-second censor warning cooldown active.' : ''}`,
    accentColor: 0xED4245,
  });
}

function channelIsInLockdownCategory(channel) {
  if (!channel) return false;
  if (channel.parentId === CONFIG.lockdownCategoryId) return true;
  return channel.parent?.parentId === CONFIG.lockdownCategoryId;
}

function containsDiscordLink(content) {
  return /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/[^\s]+|discord(?:app)?\.com\/[^\s]+)/i.test(String(content));
}

function normalizeCensorText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[7]/g, 't');
}

function normalizeCensorTerm(value) {
  return normalizeCensorText(value).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function parseCensorWords(value) {
  const pieces = String(value || '')
    .split(/[\s,;|]+/g)
    .map(piece => normalizeCensorTerm(piece))
    .filter(Boolean)
    .flatMap(piece => piece.split(' '))
    .filter(Boolean);
  return [...new Set(pieces)];
}

function normalizeStoredCensorTerms(terms) {
  const all = [];
  for (const term of Array.isArray(terms) ? terms : []) all.push(...parseCensorWords(term));
  return [...new Set(all)].sort((a, b) => a.localeCompare(b));
}

function findCensorMatch(content) {
  const base = normalizeCensorText(content);
  const spaced = ` ${base.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')} `;
  const compact = base.replace(/[^a-z0-9]+/g, '');

  for (const original of state.censoredTerms || []) {
    const term = normalizeCensorTerm(original);
    if (!term) continue;
    if (spaced.includes(` ${term} `)) return original;

    const termCompact = term.replace(/ /g, '');
    if (!term.includes(' ') && termCompact.length >= 4 && compact.includes(termCompact)) return original;
  }
  return null;
}

function registerMemberActivity(type, userId) {
  if (!state.memberActivity || typeof state.memberActivity !== 'object') {
    state.memberActivity = { trackingSince: Date.now(), events: [] };
  }
  if (!state.memberActivity.trackingSince) state.memberActivity.trackingSince = Date.now();
  if (!Array.isArray(state.memberActivity.events)) state.memberActivity.events = [];
  state.memberActivity.events.push({ type, userId, at: Date.now() });
  const cutoff = Date.now() - 370 * 24 * 60 * 60 * 1000;
  state.memberActivity.events = state.memberActivity.events.filter(e => e?.at >= cutoff && (e.type === 'join' || e.type === 'leave')).slice(-100000);
  saveState();
}

function activityTotals(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let joins = 0;
  let leaves = 0;
  for (const event of state.memberActivity?.events || []) {
    if (!event?.at || event.at < cutoff) continue;
    if (event.type === 'join') joins++;
    else if (event.type === 'leave') leaves++;
  }
  return { joins, leaves, net: joins - leaves };
}

function activityBuckets(days) {
  const result = [];
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const lookup = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const start = today - i * 24 * 60 * 60 * 1000;
    const date = new Date(start);
    const key = date.toISOString().slice(0, 10);
    const label = date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    const bucket = { key, label, start, joins: 0, leaves: 0 };
    result.push(bucket);
    lookup.set(key, bucket);
  }
  for (const event of state.memberActivity?.events || []) {
    if (!event?.at) continue;
    const key = new Date(event.at).toISOString().slice(0, 10);
    const bucket = lookup.get(key);
    if (!bucket) continue;
    if (event.type === 'join') bucket.joins++;
    else if (event.type === 'leave') bucket.leaves++;
  }
  return result;
}

function addAutoCensorWarning(userId, censorMatch) {
  state.censorWarnCooldowns ||= {};
  const now = Date.now();
  const last = Number(state.censorWarnCooldowns[userId] || 0);
  if (now - last < 60_000) return { added: false, cooldown: true, count: (state.warnings[userId] || []).length };

  const warnings = state.warnings[userId] || [];
  warnings.push({
    id: makeId(),
    reason: `Automated censor violation: ${censorMatch}`,
    moderatorId: client.user?.id || 'SYSTEM',
    createdAt: now,
    automatic: true,
  });
  state.warnings[userId] = warnings;
  state.censorWarnCooldowns[userId] = now;
  saveState();
  return { added: true, cooldown: false, count: warnings.length };
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

function prettyPermission(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}

function prettyChannelType(type) {
  const names = {
    [ChannelType.GuildText]: 'Text Channel',
    [ChannelType.DM]: 'Direct Message',
    [ChannelType.GuildVoice]: 'Voice Channel',
    [ChannelType.GroupDM]: 'Group DM',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement Channel',
    [ChannelType.AnnouncementThread]: 'Announcement Thread',
    [ChannelType.PublicThread]: 'Public Thread',
    [ChannelType.PrivateThread]: 'Private Thread',
    [ChannelType.GuildStageVoice]: 'Stage Channel',
    [ChannelType.GuildDirectory]: 'Directory',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.GuildMedia]: 'Media Channel',
  };
  return names[type] || `Type ${type}`;
}

function formatDurationFriendly(ms) {
  let seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || !parts.length) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function renderActivityGraphPng(buckets) {
  const width = 1200;
  const height = 560;
  const pixels = Buffer.alloc(width * height * 4);
  const bg = [35, 36, 40, 255];
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = bg[0]; pixels[i * 4 + 1] = bg[1]; pixels[i * 4 + 2] = bg[2]; pixels[i * 4 + 3] = bg[3];
  }
  const setPixel = (x, y, color) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = color[3] ?? 255;
  };
  const rect = (x, y, w, h, color) => {
    const x0 = Math.max(0, Math.floor(x)); const x1 = Math.min(width, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y)); const y1 = Math.min(height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) setPixel(xx, yy, color);
  };
  const margin = { left: 60, right: 35, top: 35, bottom: 45 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const max = Math.max(1, ...buckets.flatMap(b => [b.joins, b.leaves]));
  const grid = [82, 84, 92, 255];
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + chartH * (i / 5);
    rect(margin.left, y, chartW, 2, grid);
  }
  rect(margin.left, margin.top + chartH, chartW, 3, [120, 122, 130, 255]);
  const groupW = chartW / Math.max(1, buckets.length);
  const gap = Math.max(2, groupW * 0.12);
  const barW = Math.max(2, (groupW - gap * 3) / 2);
  const joinColor = [88, 101, 242, 255];
  const leaveColor = [237, 66, 69, 255];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const baseX = margin.left + i * groupW + gap;
    const jh = (b.joins / max) * (chartH - 6);
    const lh = (b.leaves / max) * (chartH - 6);
    rect(baseX, margin.top + chartH - jh, barW, jh, joinColor);
    rect(baseX + barW + gap, margin.top + chartH - lh, barW, lh, leaveColor);
  }
  // Small legend swatches in the top-left; the V2 text names the colors.
  rect(margin.left, 10, 28, 12, joinColor);
  rect(margin.left + 45, 10, 28, 12, leaveColor);
  return encodeRgbaPng(width, height, pixels);
}

function encodeRgbaPng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii');
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    typeBuf.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 8 + data.length);
    return out;
  };
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function registerJoin(member) {
  const item = {
    userId: member.id,
    joinedAt: Date.now(),
    accountCreatedAt: member.user.createdTimestamp,
  };
  state.recentJoins = [...(state.recentJoins || []).filter(j => Date.now() - j.joinedAt < 24 * 60 * 60 * 1000), item].slice(-200);
  saveState();
}

function recordRecentBan(user, displayName = null) {
  const entry = {
    userId: user.id,
    username: user.username || null,
    globalName: user.globalName || null,
    displayName,
    avatarHash: user.avatar || null,
    bannedAt: Date.now(),
  };
  const existing = (state.recentBans || []).filter(b => b.userId !== user.id);
  state.recentBans = [entry, ...existing].filter(b => Date.now() - b.bannedAt < 180 * 24 * 60 * 60 * 1000).slice(0, 200);
  saveState();
}

function evaluateAltRisk(member) {
  let score = 0;
  const reasons = [];
  const age = Date.now() - member.user.createdTimestamp;

  if (age < 24 * 60 * 60 * 1000) { score += 45; reasons.push('Discord account is less than 24 hours old (+45).'); }
  else if (age < 7 * 24 * 60 * 60 * 1000) { score += 30; reasons.push('Discord account is less than 7 days old (+30).'); }
  else if (age < 30 * 24 * 60 * 60 * 1000) { score += 15; reasons.push('Discord account is less than 30 days old (+15).'); }
  else if (age < 90 * 24 * 60 * 60 * 1000) { score += 5; reasons.push('Discord account is less than 90 days old (+5).'); }

  if (!member.user.avatar) { score += 10; reasons.push('Account has no custom avatar (+10).'); }

  const recentBans = (state.recentBans || []).filter(b => Date.now() - b.bannedAt < 90 * 24 * 60 * 60 * 1000 && b.userId !== member.id);
  if (member.user.avatar) {
    const avatarMatch = recentBans.find(b => b.avatarHash && b.avatarHash === member.user.avatar);
    if (avatarMatch) { score += 60; reasons.push(`Uses the same avatar hash as recently banned user ${safeIdentity(avatarMatch)} (+60).`); }
  }

  let bestSimilarity = null;
  for (const ban of recentBans) {
    for (const left of [member.user.username, member.user.globalName, member.displayName]) {
      for (const right of [ban.username, ban.globalName, ban.displayName]) {
        if (!left || !right) continue;
        const similarity = nameSimilarity(left, right);
        if (!bestSimilarity || similarity > bestSimilarity.similarity) bestSimilarity = { similarity, ban, left, right };
      }
    }
  }
  if (bestSimilarity?.similarity >= 0.94) {
    score += 40;
    reasons.push(`Name is extremely similar to recently banned user ${safeIdentity(bestSimilarity.ban)} (+40).`);
  } else if (bestSimilarity?.similarity >= 0.82) {
    score += 25;
    reasons.push(`Name is similar to recently banned user ${safeIdentity(bestSimilarity.ban)} (+25).`);
  }

  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  const recent = (state.recentJoins || []).filter(j => j.joinedAt >= tenMinutesAgo);
  if (recent.length >= 5) { score += 20; reasons.push(`${recent.length} accounts joined within the last 10 minutes (+20).`); }
  else if (recent.length >= 3) { score += 10; reasons.push(`${recent.length} accounts joined within the last 10 minutes (+10).`); }

  const freshRecent = recent.filter(j => Date.now() - j.accountCreatedAt < 7 * 24 * 60 * 60 * 1000);
  if (freshRecent.length >= 3) { score += 15; reasons.push(`${freshRecent.length} very new accounts joined in the same 10-minute window (+15).`); }

  return { score: Math.min(100, score), reasons };
}

async function sendAltRiskLog(member, assessment, pingAdmins) {
  const channel = await client.channels.fetch(CONFIG.modLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const ping = pingAdmins ? await getAdminPing(member.guild) : { text: '', allowedMentions: { parse: [] } };
  const reasons = assessment.reasons.length ? assessment.reasons.map(r => `- ${r}`).join('\n') : '- No notable signals.';
  const title = pingAdmins ? `Possible Alt Account - ${altRiskLabel(assessment.score)} Risk` : 'Alt Risk Join Logged';
  const description = `${ping.text ? `${ping.text}\n\n` : ''}${member} (\`${member.id}\`) joined the server.\n\n**Risk Score**\n**${assessment.score}/100**\n\n**Account Created**\n<t:${Math.floor(member.user.createdTimestamp / 1000)}:F> (<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)\n\n**Signals**\n${reasons}\n\n-# Heuristic alert only - this is not proof the member is an alt. Discord bots cannot access member IP addresses or device identity.`;

  await channel.send(v2Payload({
    title,
    description,
    accentColor: altRiskColor(assessment.score),
    allowedMentions: ping.allowedMentions,
  })).catch(error => console.error('[ALT] Failed to send alert:', error));
}

async function getAdminPing(guild) {
  if (CONFIG.adminAlertRoleId) {
    const role = await guild.roles.fetch(CONFIG.adminAlertRoleId).catch(() => null);
    if (role) return { text: `<@&${role.id}>`, allowedMentions: { roles: [role.id] } };
  }

  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const admins = [...members.values()]
    .filter(m => !m.user.bot && m.permissions.has(PermissionFlagsBits.Administrator))
    .slice(0, 20);
  if (!admins.length) return { text: `<@${guild.ownerId}>`, allowedMentions: { users: [guild.ownerId] } };
  return { text: admins.map(m => `<@${m.id}>`).join(' '), allowedMentions: { users: admins.map(m => m.id) } };
}

function safeIdentity(entry) {
  return `**${escapeMassMentions(entry.username || entry.globalName || 'unknown')}** (\`${entry.userId}\`)`;
}

function nameSimilarity(a, b) {
  const x = normalizeIdentity(a);
  const y = normalizeIdentity(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const distance = levenshtein(x, y);
  return 1 - distance / Math.max(x.length, y.length);
}

function normalizeIdentity(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\d+$/g, '');
}

function levenshtein(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let previous = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    const current = [j];
    for (let i = 1; i <= a.length; i++) {
      current[i] = Math.min(current[i - 1] + 1, previous[i] + 1, previous[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[a.length];
}

function altRiskLabel(score) {
  if (score >= 70) return 'High';
  if (score >= CONFIG.altAlertThreshold) return 'Medium';
  if (score >= 25) return 'Watch';
  return 'Low';
}

function altRiskColor(score) {
  if (score >= 70) return 0xED4245;
  if (score >= CONFIG.altAlertThreshold) return 0xFEE75C;
  return 0x5865F2;
}

async function checkTempBans() {
  if (!client.isReady()) return;
  const due = Object.entries(state.tempBans || {}).filter(([, info]) => info.unbanAt <= Date.now());
  if (!due.length) return;
  const guild = await client.guilds.fetch(CONFIG.guildId);

  for (const [userId, info] of due) {
    try {
      const user = await guild.members.unban(userId, `Temporary ban expired: ${info.reason}`).catch(error => {
        if (error?.code === 10026) return null;
        throw error;
      });
      delete state.tempBans[userId];
      saveState();
      if (user) {
        await logAction({ title: 'Temporary Ban Expired', description: `<@${userId}> (\`${userId}\`) was automatically unbanned.`, moderator: client.user, reason: info.reason, accentColor: 0x57F287 });
      }
    } catch (error) {
      console.error(`[TEMPBAN] Failed to expire ${userId}:`, error);
    }
  }
}

function formatDurationLoose(ms) {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function escapeCode(text) {
  return String(text || '').replace(/`/g, '\\`');
}

function clampNumber(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

async function checkBaptismSchedule() {
  if (schedulerBusy || !client.isReady()) return;
  if (!state.nextBaptismAt || Date.now() < state.nextBaptismAt) return;

  schedulerBusy = true;
  try {
    await runBaptism({ mode: 'Automatic', moderator: client.user, reason: 'Scheduled 3-day chat baptism' });
    state.nextBaptismAt = Date.now() + THREE_DAYS_MS;
    saveState();
    console.log(`[BAPTISM] Complete. Next run: ${new Date(state.nextBaptismAt).toISOString()}`);
  } catch (error) {
    console.error('[BAPTISM] Scheduled run failed:', error);
    // Retry in 15 minutes rather than waiting another 3 days.
    state.nextBaptismAt = Date.now() + 15 * 60 * 1000;
    saveState();
  } finally {
    schedulerBusy = false;
  }
}

async function runBaptism({ mode, moderator, reason }) {
  const channel = await client.channels.fetch(CONFIG.baptismChannelId);
  if (!channel?.isTextBased() || !('messages' in channel)) throw new Error('Configured baptism channel is not a text channel.');

  const deleted = await clearWholeChannel(channel);
  await channel.send({ content: BAPTISM_TEXT, allowedMentions: { parse: [] } });

  await logAction({
    title: `${mode} Chat Baptism`,
    description: `Cleared **${deleted}** non-pinned message(s) from <#${CONFIG.baptismChannelId}> and sent the baptism message.`,
    moderator,
    reason,
    extra: mode === 'Automatic' ? 'Schedule: every 3 days' : 'Triggered manually',
    accentColor: 0x5865F2,
  });

  return { deleted };
}


async function handleTalk(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers))) return;
  const message = interaction.options.getString('message', true).trim();
  const user = interaction.options.getUser('user');
  const selectedChannel = interaction.options.getChannel('channel');

  // User takes priority when both optional targets are supplied. Otherwise use the
  // selected text channel, then fall back to the channel where /talk was run.
  if (user) {
    if (user.bot) return fail(interaction, 'Cannot DM Bot', 'Pick a real user instead of a bot account.');

    await interaction.reply(v2Payload({
      title: 'Sending DM',
      description: `Sending your message to **${escapeMassMentions(user.tag)}**.`,
      accentColor: 0x5865F2,
      ephemeral: true,
    }));

    try {
      await user.send({
        content: message,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await logAction({
        title: 'Talk DM Failed',
        description: `A staff DM to ${user} could not be delivered. The user may have DMs disabled or may be blocking the bot.`,
        moderator: interaction.user,
        target: user,
        extra: `Message:\n${truncate(escapeMassMentions(message), 1200)}`,
        accentColor: 0xED4245,
      });

      return interaction.editReply(v2Edit({
        title: 'DM Failed',
        description: `I couldn't DM **${escapeMassMentions(user.tag)}**. They may have server DMs disabled or may be blocking the bot.`,
        accentColor: 0xED4245,
      }));
    }

    await logAction({
      title: 'Staff Talk DM Sent',
      description: `${user} was sent a direct message through the bot.`,
      moderator: interaction.user,
      target: user,
      extra: `Message:\n${truncate(escapeMassMentions(message), 1200)}`,
      accentColor: 0x57F287,
    });

    return interaction.editReply(v2Edit({
      title: 'DM Sent',
      description: `Sent your message to **${escapeMassMentions(user.tag)}**. ${EMOJIS.smileyTom}`,
      accentColor: 0x57F287,
    }));
  }

  const channel = selectedChannel || interaction.channel;
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return fail(interaction, 'Invalid Channel', 'Pick a text channel that the bot can send messages in.');
  }

  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  const perms = me && channel.permissionsFor?.(me);
  if (perms && (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages))) {
    return fail(interaction, 'Cannot Send There', `I don't have permission to send messages in ${channel}.`);
  }

  await interaction.reply(v2Payload({
    title: 'Sending Message',
    description: `Sending your plain-text message in ${channel}.`,
    accentColor: 0x5865F2,
    ephemeral: true,
  }));

  try {
    await channel.send({
      content: message,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await logAction({
      title: 'Talk Channel Send Failed',
      description: `A staff /talk message could not be sent to ${channel}.`,
      moderator: interaction.user,
      extra: `Message:\n${truncate(escapeMassMentions(message), 1200)}`,
      accentColor: 0xED4245,
    });
    return interaction.editReply(v2Edit({
      title: 'Send Failed',
      description: `I couldn't send that message in ${channel}. Check my channel permissions.`,
      accentColor: 0xED4245,
    }));
  }

  await logAction({
    title: 'Staff Talk Message Sent',
    description: `A plain-text /talk message was sent to ${channel}.`,
    moderator: interaction.user,
    extra: `Message:\n${truncate(escapeMassMentions(message), 1200)}`,
    accentColor: 0x57F287,
  });

  return interaction.editReply(v2Edit({
    title: 'Message Sent',
    description: `Sent the message in ${channel}. ${EMOJIS.smileyTom}`,
    accentColor: 0x57F287,
  }));
}

async function handleRoleInfo(interaction) {
  const role = interaction.options.getRole('role', true);
  await interaction.guild.members.fetch().catch(() => null);
  const perms = role.permissions.toArray();
  const created = Math.floor(role.createdTimestamp / 1000);
  const color = role.color ? role.hexColor : 'Default';
  const permissionText = perms.length ? truncate(perms.map(prettyPermission).join(', '), 1200) : 'None';

  return interaction.reply(v2Payload({
    title: `Role Info - ${role.name}`,
    description:
      `**Role**\n${role}\n\n` +
      `**Role ID**\n\`\`\`${role.id}\`\`\`\n\n` +
      `**Members**\n${role.members.size.toLocaleString()}\n\n` +
      `**Position**\n${role.position}\n\n` +
      `**Color**\n${color}\n\n` +
      `**Hoisted**\n${yesNo(role.hoist)}\n\n` +
      `**Mentionable**\n${yesNo(role.mentionable)}\n\n` +
      `**Managed by Integration/Bot**\n${yesNo(role.managed)}\n\n` +
      `**Created**\n<t:${created}:F> (<t:${created}:R>)\n\n` +
      `**Permissions**\n${permissionText}`,
  }));
}

async function handleMemberInfo(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');

  const created = Math.floor(user.createdTimestamp / 1000);
  const joined = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
  const roles = [...member.roles.cache.values()]
    .filter(r => r.id !== interaction.guild.id)
    .sort((a, b) => b.position - a.position);
  const roleText = roles.length ? truncate(roles.map(r => `${r}`).join(' '), 1000) : 'No roles';
  const timeout = member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
    ? `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:F> (<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>)`
    : 'No';
  const staffCanSeeWarnings = interaction.member?.permissions?.has(PermissionFlagsBits.ModerateMembers) || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  const warningText = staffCanSeeWarnings ? `\n\n**Warnings on Record**\n${(state.warnings[user.id] || []).length}` : '';

  return interaction.reply(v2Payload({
    title: `Member Info - ${member.displayName}`,
    description:
      `**User**\n${user}\n\n` +
      `**Username**\n${escapeMassMentions(user.tag || user.username)}\n\n` +
      `**Display Name**\n${escapeMassMentions(member.displayName)}\n\n` +
      `**User ID**\n\`${user.id}\`\n\n` +
      `**Account Created**\n<t:${created}:F> (<t:${created}:R>)\n\n` +
      `**Joined Server**\n${joined ? `<t:${joined}:F> (<t:${joined}:R>)` : 'Unknown'}\n\n` +
      `**Bot Account**\n${yesNo(user.bot)}\n\n` +
      `**Timed Out**\n${timeout}\n\n` +
      `**Roles (${roles.length})**\n${roleText}${warningText}`,
  }));
}

async function handleServerInfo(interaction) {
  const guild = interaction.guild;
  const owner = await guild.fetchOwner().catch(() => null);
  const created = Math.floor(guild.createdTimestamp / 1000);
  const channels = guild.channels.cache;
  const textChannels = channels.filter(ch => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement).size;
  const voiceChannels = channels.filter(ch => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice).size;
  const categories = channels.filter(ch => ch.type === ChannelType.GuildCategory).size;

  return interaction.reply(v2Payload({
    title: `Server Info - ${guild.name}`,
    description:
      `**Server ID**\n\`${guild.id}\`\n\n` +
      `**Owner**\n${owner ? `${owner} (\`${owner.id}\`)` : 'Unknown'}\n\n` +
      `**Created**\n<t:${created}:F> (<t:${created}:R>)\n\n` +
      `**Members**\n${guild.memberCount.toLocaleString()}\n\n` +
      `**Roles**\n${guild.roles.cache.size.toLocaleString()}\n\n` +
      `**Channels**\n${channels.size.toLocaleString()} total - ${textChannels} text - ${voiceChannels} voice - ${categories} categories\n\n` +
      `**Emojis**\n${guild.emojis.cache.size.toLocaleString()}\n\n` +
      `**Stickers**\n${guild.stickers.cache.size.toLocaleString()}\n\n` +
      `**Boosts**\n${guild.premiumSubscriptionCount || 0} - Level ${guild.premiumTier}`,
  }));
}

async function handleServerStats(interaction) {
  const guild = interaction.guild;
  const members = await guild.members.fetch();
  const humans = members.filter(m => !m.user.bot).size;
  const bots = members.filter(m => m.user.bot).size;
  const stats24h = activityTotals(1);
  const stats7d = activityTotals(7);
  const stats30d = activityTotals(30);
  const warningCount = Object.values(state.warnings || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const trackingSince = state.memberActivity?.trackingSince || Date.now();

  return interaction.reply(v2Payload({
    title: 'Server Stats',
    description:
      `**Current Members**\n${guild.memberCount.toLocaleString()}\n\n` +
      `**Humans**\n${humans.toLocaleString()}\n\n` +
      `**Bots**\n${bots.toLocaleString()}\n\n` +
      `**Last 24 Hours**\n${stats24h.joins} joins - ${stats24h.leaves} leaves - Net ${formatSigned(stats24h.net)}\n\n` +
      `**Last 7 Days**\n${stats7d.joins} joins - ${stats7d.leaves} leaves - Net ${formatSigned(stats7d.net)}\n\n` +
      `**Last 30 Days**\n${stats30d.joins} joins - ${stats30d.leaves} leaves - Net ${formatSigned(stats30d.net)}\n\n` +
      `**Warnings on Record**\n${warningCount.toLocaleString()}\n\n` +
      `**Censor Triggers**\n${(state.censoredTerms || []).length.toLocaleString()}\n\n` +
      `**Activity Tracking Started**\n<t:${Math.floor(trackingSince / 1000)}:F>`,
  }));
}

async function handleServerGraph(interaction) {
  const value = interaction.options.getString('range') || '7d';
  const days = value === '30d' ? 30 : value === '14d' ? 14 : 7;
  const buckets = activityBuckets(days);
  const totals = buckets.reduce((acc, b) => ({ joins: acc.joins + b.joins, leaves: acc.leaves + b.leaves }), { joins: 0, leaves: 0 });
  const png = renderActivityGraphPng(buckets);
  const attachment = new AttachmentBuilder(png, { name: `server-growth-${days}d.png` });
  const trackingSince = state.memberActivity?.trackingSince || Date.now();
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# Server Growth - ${days} Days\n` +
      `**Period:** ${buckets[0]?.label || 'Unknown'} - ${buckets.at(-1)?.label || 'Unknown'} (UTC)\n` +
      `**Joins:** ${totals.joins}  •  **Leaves:** ${totals.leaves}  •  **Net:** ${formatSigned(totals.joins - totals.leaves)}\n\n` +
      `Blue bars = joins  •  Red bars = leaves\n` +
      `-# Activity is recorded by this bot from <t:${Math.floor(trackingSince / 1000)}:F> onward. Days are grouped in UTC.`
    ));
  const gallery = new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder()
      .setURL(`attachment://server-growth-${days}d.png`)
      .setDescription(`${days}-day server joins vs leaves graph`)
  );
  container.addMediaGalleryComponents(gallery);

  return interaction.reply({
    components: [container],
    files: [attachment],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

async function handleChannelInfo(interaction) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel || !('id' in channel)) return fail(interaction, 'Channel Not Found', 'I could not resolve that channel.');
  const created = channel.createdTimestamp ? Math.floor(channel.createdTimestamp / 1000) : null;
  const parent = channel.parentId ? `<#${channel.parentId}>` : 'None';
  const topic = 'topic' in channel && channel.topic ? truncate(channel.topic, 900) : 'None';
  const slowmode = 'rateLimitPerUser' in channel ? `${channel.rateLimitPerUser || 0} seconds` : 'Not applicable';

  return interaction.reply(v2Payload({
    title: `Channel Info - ${channel.name || channel.id}`,
    description:
      `**Channel**\n${channel}\n\n` +
      `**Channel ID**\n\`${channel.id}\`\n\n` +
      `**Type**\n${prettyChannelType(channel.type)}\n\n` +
      `**Category / Parent**\n${parent}\n\n` +
      `**Created**\n${created ? `<t:${created}:F> (<t:${created}:R>)` : 'Unknown'}\n\n` +
      `**Slowmode**\n${slowmode}\n\n` +
      `**NSFW**\n${'nsfw' in channel ? yesNo(channel.nsfw) : 'Not applicable'}\n\n` +
      `**Topic**\n${escapeMassMentions(topic)}`,
  }));
}

async function handleAvatar(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  const url = user.displayAvatarURL({ extension: 'png', size: 4096, forceStatic: false });
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Avatar - ${escapeMassMentions(user.username)}\n**User ID**\n\`${user.id}\``));
  const gallery = new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(url).setDescription(`${user.username}'s avatar`)
  );
  container.addMediaGalleryComponents(gallery);
  return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function handlePermissions(interaction) {
  const user = interaction.options.getUser('member') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return fail(interaction, 'Member Not Found', 'That user is not currently in the server.');
  const perms = member.permissions.toArray();
  const body = perms.length ? perms.map(prettyPermission).sort().join('\n') : 'No server permissions.';
  return interaction.reply(v2Payload({
    title: `Permissions - ${member.displayName}`,
    description: `**User ID**\n\`${user.id}\`\n\n**Effective Server Permissions (${perms.length})**\n${truncate(body, 3000)}`,
  }));
}

async function handleRoleList(interaction) {
  const roles = [...interaction.guild.roles.cache.values()]
    .filter(role => role.id !== interaction.guild.id)
    .sort((a, b) => b.position - a.position);
  const shown = roles.slice(0, 35);
  const body = shown.length
    ? shown.map((role, index) => `**${index + 1}.** ${role} - \`${role.id}\``).join('\n')
    : 'No roles found.';
  return interaction.reply(v2Payload({
    title: `Role List - ${interaction.guild.name}`,
    description: `${body}${roles.length > shown.length ? `\n\nShowing ${shown.length} of ${roles.length} roles.` : ''}`,
  }));
}

async function handleServerIcon(interaction) {
  const url = interaction.guild.iconURL({ extension: 'png', size: 4096, forceStatic: false });
  if (!url) return fail(interaction, 'No Server Icon', 'This server does not currently have an icon.');
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Server Icon - ${escapeMassMentions(interaction.guild.name)}\n**Server ID**\n\`${interaction.guild.id}\``));
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(url).setDescription(`${interaction.guild.name} server icon`)
  ));
  return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function handlePing(interaction) {
  const latency = Math.max(0, Math.round(client.ws.ping));
  return interaction.reply(v2Payload({
    title: 'Bot Status',
    description: `**Gateway Latency**\n${latency} ms\n\n**Uptime**\n${formatDurationFriendly(client.uptime || 0)}`,
  }));
}

async function handleBotInfo(interaction) {
  const uptime = client.uptime || 0;
  const startedAt = Date.now() - uptime;
  const guild = interaction.guild;
  return interaction.reply(v2Payload({
    title: 'Bot Info',
    description:
      `**Bot**\n${client.user}\n\n` +
      `**Bot ID**\n\`${client.user.id}\`\n\n` +
      `**Version**\n1.9.0\n\n` +
      `**Uptime**\n${formatDurationFriendly(uptime)}\n\n` +
      `**Online Since**\n<t:${Math.floor(startedAt / 1000)}:F> (<t:${Math.floor(startedAt / 1000)}:R>)\n\n` +
      `**Registered Commands**\n${commands.length}\n\n` +
      `**Server**\n${escapeMassMentions(guild.name)} (\`${guild.id}\`)`,
  }));
}

async function handleDmAll(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const message = interaction.options.getString('message', true).trim();
  const role = interaction.options.getRole('role');

  await interaction.reply(v2Payload({
    title: 'DM Broadcast Starting',
    description: role
      ? `Sending the plain-text message only to non-bot members with ${role}. Members with closed DMs will be counted as failed deliveries.`
      : 'Sending the plain-text message to every non-bot member. Members with closed DMs will be counted as failed deliveries.',
    accentColor: 0x5865F2,
    ephemeral: true,
  }));

  const members = await interaction.guild.members.fetch();
  const recipients = [...members.values()].filter(member =>
    !member.user.bot && (!role || member.roles.cache.has(role.id))
  );

  if (!recipients.length) {
    return interaction.editReply(v2Edit({
      title: 'No Recipients',
      description: role ? `There are no non-bot members with ${role} to DM.` : 'There are no non-bot members to DM.',
      accentColor: 0xFEE75C,
    }));
  }

  let sent = 0;
  let failed = 0;

  // Small worker pool: discord.js still handles API rate limits, while this avoids
  // launching hundreds or thousands of DM requests at exactly the same instant.
  const queue = [...recipients];
  const workerCount = Math.min(4, Math.max(1, queue.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const member = queue.shift();
      if (!member) break;
      try {
        await member.send({
          content: message,
          allowedMentions: { parse: [] },
        });
        sent++;
      } catch {
        failed++;
      }
    }
  });

  await Promise.all(workers);

  const scopeText = role ? `members with ${role}` : 'all non-bot server members';
  await logAction({
    title: 'DM Broadcast Complete',
    description: `A DM broadcast to ${scopeText} finished. **${sent}** delivered and **${failed}** failed out of **${recipients.length}** attempted recipient(s).`,
    moderator: interaction.user,
    extra: `${role ? `Role: ${role} (\`${role.id}\`)\n` : ''}Message:\n${truncate(escapeMassMentions(message), 1200)}`,
    accentColor: failed ? 0xFEE75C : 0x57F287,
  });

  return interaction.editReply(v2Edit({
    title: 'DM Broadcast Complete',
    description: `${role ? `**Role:** ${role}\n` : '**Target:** Everyone\n'}**Delivered:** ${sent}\n**Failed:** ${failed}\n**Attempted:** ${recipients.length}\n\nFailed deliveries usually mean that member has DMs disabled or is blocking the bot.`,
    accentColor: failed ? 0xFEE75C : 0x57F287,
  }));
}

async function clearWholeChannel(channel) {
  let deleted = 0;
  let before;
  let safety = 0;

  while (safety++ < 500) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;

    before = batch.last().id;
    const unpinned = batch.filter(m => !m.pinned);
    const recent = unpinned.filter(m => Date.now() - m.createdTimestamp < FOURTEEN_DAYS_MS);
    const old = unpinned.filter(m => Date.now() - m.createdTimestamp >= FOURTEEN_DAYS_MS);

    if (recent.size) {
      const result = await channel.bulkDelete(recent, true);
      deleted += result.size;
    }

    // Messages older than 14 days cannot be bulk deleted; delete them individually.
    for (const message of old.values()) {
      await message.delete().then(() => { deleted++; }).catch(() => {});
    }

    if (batch.size < 100) break;
  }

  return deleted;
}

async function purgeRecent(channel, amount, targetUserId) {
  let deleted = 0;
  let scanned = 0;
  let before;

  while (deleted < amount && scanned < 2500) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    before = batch.last().id;
    scanned += batch.size;

    let candidates = batch.filter(m => !m.pinned && Date.now() - m.createdTimestamp < FOURTEEN_DAYS_MS);
    if (targetUserId) candidates = candidates.filter(m => m.author.id === targetUserId);
    candidates = candidates.first(amount - deleted);

    if (candidates.length) {
      const result = await channel.bulkDelete(candidates, true);
      deleted += result.size;
    }

    if (batch.size < 100) break;
  }

  return deleted;
}

function snapshotOverwrite(channel, roleId) {
  const overwrite = channel.permissionOverwrites.cache.get(roleId);
  if (!overwrite) return null;
  return { allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() };
}

async function restoreOverwrite(channel, roleId, snapshot, reason) {
  if (!snapshot) {
    const existing = channel.permissionOverwrites.cache.get(roleId);
    if (existing) await channel.permissionOverwrites.delete(roleId, reason);
    return;
  }

  const allow = new PermissionsBitField(BigInt(snapshot.allow));
  const deny = new PermissionsBitField(BigInt(snapshot.deny));
  const options = {};

  for (const [name, bit] of Object.entries(PermissionFlagsBits)) {
    if (allow.has(bit)) options[name] = true;
    else if (deny.has(bit)) options[name] = false;
    else options[name] = null;
  }

  await channel.permissionOverwrites.edit(roleId, options, { reason });
}

function permissionTriState(overwrite, bit) {
  if (!overwrite) return null;
  if (overwrite.allow.has(bit)) return true;
  if (overwrite.deny.has(bit)) return false;
  return null;
}

async function logIncomingDM(message) {
  if (!message?.author || message.author.bot) return;

  const channel = await client.channels.fetch(CONFIG.dmLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[DM LOG] Could not find text DM log channel ${CONFIG.dmLogChannelId}`);
    return;
  }

  const content = message.content?.trim()
    ? truncate(message.content.trim(), 2800)
    : '*No text - attachment/sticker only.*';

  const attachments = [...message.attachments.values()];
  const stickers = [...message.stickers.values()];
  const mediaItems = [];
  const fileLines = [];

  for (const attachment of attachments) {
    const contentType = attachment.contentType || '';
    const isMedia = contentType.startsWith('image/') || contentType.startsWith('video/');

    if (isMedia && mediaItems.length < 10) {
      mediaItems.push({
        url: attachment.url,
        description: truncate(attachment.name || 'DM attachment', 180),
        spoiler: Boolean(attachment.spoiler),
      });
    } else {
      const size = formatBytes(attachment.size);
      fileLines.push(`- [${escapeMarkdownLinkText(attachment.name || 'Attachment')}](${attachment.url})${size ? ` - ${size}` : ''}`);
    }
  }

  // Stickers are visual content too. Put them into the gallery where possible.
  for (const sticker of stickers) {
    if (sticker.url && mediaItems.length < 10) {
      mediaItems.push({
        url: sticker.url,
        description: truncate(`Sticker: ${sticker.name || sticker.id}`, 180),
        spoiler: false,
      });
    } else if (sticker.url) {
      fileLines.push(`- [Sticker: ${escapeMarkdownLinkText(sticker.name || sticker.id)}](${sticker.url})`);
    }
  }

  // If there were more than 10 images/videos, keep links to the overflow so no
  // attachment disappears from the audit trail.
  const galleryUrls = new Set(mediaItems.map(item => item.url));
  for (const attachment of attachments) {
    if (!galleryUrls.has(attachment.url) && !fileLines.some(line => line.includes(attachment.url))) {
      fileLines.push(`- [${escapeMarkdownLinkText(attachment.name || 'Attachment')}](${attachment.url})`);
    }
  }

  const attachmentSummary = attachments.length || stickers.length
    ? `\n\n**Attachments**\n${attachments.length} file(s)${stickers.length ? ` • ${stickers.length} sticker(s)` : ''}`
    : '';
  const filesText = fileLines.length ? `\n${fileLines.join('\n')}` : '';

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# Incoming DM\n` +
      `**User**\n<@${message.author.id}>\n` +
      `**Username**\n${escapeMassMentions(message.author.tag || message.author.username)}\n` +
      `**User ID**\n\`${message.author.id}\`\n\n` +
      `**Message**\n${escapeMassMentions(content)}` +
      `${attachmentSummary}${filesText}\n\n` +
      `<t:${Math.floor(message.createdTimestamp / 1000)}:F>`
    ));

  if (mediaItems.length) {
    const gallery = new MediaGalleryBuilder();
    gallery.addItems(...mediaItems.map(item => {
      const media = new MediaGalleryItemBuilder()
        .setURL(item.url)
        .setDescription(item.description);
      if (item.spoiler) media.setSpoiler(true);
      return media;
    }));
    container.addMediaGalleryComponents(gallery);
  }

  await channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function escapeMarkdownLinkText(text) {
  return String(text || '').replace(/([\\\[\]])/g, '\\$1').replace(/\n/g, ' ');
}

async function sendModerationDM(user, { guildName, action, reason, duration, details }) {
  const durationText = duration ? `\n**Duration**\n${escapeMassMentions(duration)}` : '';
  const detailsText = details ? `\n\n${details}` : '';

  return user.send(v2Payload({
    title: 'Moderation Notice',
    description: `A moderation action was taken against your account in **${escapeMassMentions(guildName)}**.\n\n**Action**\n${escapeMassMentions(action)}${durationText}\n\n**Reason**\n${escapeMassMentions(reason || 'No reason provided.')}${detailsText}`,
  })).then(() => true).catch(() => false);
}

function moderationDmStatus(sent) {
  return sent ? '**DM Notice:** Delivered' : '**DM Notice:** Could not be delivered (DMs may be closed)';
}

async function logAction({ title, description, moderator, reason, target, extra, accentColor }) {
  const channel = await client.channels.fetch(CONFIG.modLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[LOG] Could not find text log channel ${CONFIG.modLogChannelId}`);
    return;
  }

  const moderatorText = moderator?.id ? `<@${moderator.id}> (\`${moderator.id}\`)` : 'System';
  const targetText = target?.id ? `\n**Target**\n<@${target.id}> (\`${target.id}\`)` : '';
  const extraText = extra ? `\n**Details**\n${extra}` : '';
  const reasonText = reason ? `\n**Reason**\n${escapeMassMentions(reason)}` : '';

  await channel.send(v2Payload({
    title,
    description: `${description}\n\n**Moderator**\n${moderatorText}${targetText}${reasonText}${extraText}\n\n<t:${Math.floor(Date.now() / 1000)}:F>`,
    accentColor,
  })).catch(error => console.error('[LOG] Failed to send moderation log:', error));
}

async function requirePermission(interaction, permission) {
  const member = interaction.member;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member?.permissions?.has(permission)) return true;

  await interaction.reply(v2Payload({
    title: 'Missing Permission',
    description: 'You do not have permission to use this moderation command.',
    accentColor: 0xED4245,
    ephemeral: true,
  }));
  return false;
}

function canActOn(actorMember, targetMember, guild) {
  if (!actorMember || !targetMember) return false;
  if (guild.ownerId === actorMember.id) return targetMember.id !== guild.ownerId;
  if (targetMember.id === guild.ownerId) return false;
  return actorMember.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
}

async function fail(interaction, title, description) {
  const payload = v2Payload({ title, description, accentColor: 0xED4245, ephemeral: true });
  if (interaction.replied || interaction.deferred) return interaction.editReply(stripEphemeralFlag(payload));
  return interaction.reply(payload);
}

function v2Payload({ title, description, ephemeral = false, allowedMentions = { parse: [] } }) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${escapeMassMentions(title)}\n${escapeMassMentions(description)}`));

  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) flags |= MessageFlags.Ephemeral;

  return {
    components: [container],
    flags,
    allowedMentions,
  };
}

function v2Edit({ title, description }) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${escapeMassMentions(title)}\n${escapeMassMentions(description)}`));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function stripEphemeralFlag(payload) {
  return { ...payload, flags: MessageFlags.IsComponentsV2 };
}

function loadState() {
  const defaults = {
    version: 4,
    nextBaptismAt: null,
    lockdown: { active: false, channels: {} },
    warnings: {},
    channelLocks: {},
    censoredTerms: [],
    tempBans: {},
    recentBans: [],
    recentJoins: [],
    memberActivity: { trackingSince: Date.now(), events: [] },
    censorWarnCooldowns: {},
  };

  if (!fs.existsSync(STATE_FILE)) return defaults;

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      ...defaults,
      ...parsed,
      warnings: parsed.warnings || {},
      channelLocks: parsed.channelLocks || {},
      censoredTerms: normalizeStoredCensorTerms(parsed.censoredTerms),
      tempBans: parsed.tempBans || {},
      recentBans: Array.isArray(parsed.recentBans) ? parsed.recentBans : [],
      recentJoins: Array.isArray(parsed.recentJoins) ? parsed.recentJoins : [],
      memberActivity: parsed.memberActivity && typeof parsed.memberActivity === 'object'
        ? {
            trackingSince: parsed.memberActivity.trackingSince || Date.now(),
            events: Array.isArray(parsed.memberActivity.events) ? parsed.memberActivity.events : [],
          }
        : defaults.memberActivity,
      censorWarnCooldowns: parsed.censorWarnCooldowns && typeof parsed.censorWarnCooldowns === 'object' ? parsed.censorWarnCooldowns : {},
      lockdown: parsed.lockdown || defaults.lockdown,
    };
  } catch (error) {
    console.error('[STATE] Failed to read state.json; using fresh state:', error);
    return defaults;
  }
}

function saveState() {
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, STATE_FILE);
}

function parseDuration(input) {
  const normalized = String(input).trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  const factors = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const ms = Math.floor(value * factors[unit]);
  return ms > 0 ? ms : null;
}

function formatDuration(ms) {
  const units = [
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
  ];
  for (const [name, size] of units) {
    if (ms >= size && ms % size === 0) {
      const value = ms / size;
      return `${value} ${name}${value === 1 ? '' : 's'}`;
    }
  }
  return `${Math.round(ms / 60_000)} minutes`;
}

function makeId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function truncate(text, max) {
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function escapeMassMentions(text) {
  return String(text ?? '').replace(/@everyone/g, '@\u200beveryone').replace(/@here/g, '@\u200bhere');
}

function parseColor(value) {
  const raw = String(value).trim();
  const parsed = raw.toLowerCase().startsWith('0x') ? Number.parseInt(raw.slice(2), 16) : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFF ? parsed : 0x78B7FF;
}

process.on('unhandledRejection', error => console.error('[UNHANDLED REJECTION]', error));
process.on('uncaughtException', error => console.error('[UNCAUGHT EXCEPTION]', error));

client.login(CONFIG.token);
