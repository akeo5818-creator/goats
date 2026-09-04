import {
  ActionRowBuilder,
  ActivityType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  Partials,
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const LEGACY_DATA_DIR = path.join(ROOT, 'data');

function resolveDataDir() {
  const railwayVolume = String(process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  if (railwayVolume) return railwayVolume;
  if (process.env.USE_DATA_DIR === '1' || fs.existsSync('/data')) return '/data';
  return LEGACY_DATA_DIR;
}

const DATA_DIR = resolveDataDir();
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LEGACY_STATE_FILE = path.join(LEGACY_DATA_DIR, 'state.json');

const CONFIG = {
  token: process.env.BOT_TOKEN,
  guildId: process.env.GUILD_ID || '1537689864827445278',
  customerRoleId: process.env.CUSTOMER_ROLE_ID || '1537689864827445285',
  lockdownCategoryId: process.env.LOCKDOWN_CATEGORY_ID || '1537689865267974192',
  baptismChannelId: process.env.BAPTISM_CHANNEL_ID || '1537689865267974193',
  modLogChannelId: process.env.MOD_LOG_CHANNEL_ID || '1537728472997306389',
  dmLogChannelId: process.env.DM_LOG_CHANNEL_ID || '1541705487052046408',
  pollResultsChannelId: process.env.POLL_RESULTS_CHANNEL_ID || null,
  adminAlertRoleId: process.env.ADMIN_ALERT_ROLE_ID || null,
  altAlertThreshold: clampNumber(Number(process.env.ALT_ALERT_THRESHOLD || 40), 20, 100, 40),
  timeZone: process.env.SERVER_TIME_ZONE || 'Pacific/Auckland',
};

const EMOJIS = {
  thumbsUpTom: '<:ThumbsupTom:1537715616369217567>',
  smileyTom: '<:SmileyTom:1537715428233715742>',
};

const BAPTISM_TEXT = `Chat has been baptized once again ${EMOJIS.thumbsUpTom}`;
const SUPPORT_TICKETS_URL = 'https://discord.com/channels/1537689864827445278/1537689865267974190';
const TOURNAMENT_CHANNEL_NAME = 'pvp-tournaments';
const FAQ_CHANNEL_NAME = 'faq';
const CHAMPION_ROLE_NAME = 'Champion';
const TOURNAMENT_REGISTRATION_MINUTES = 10;
const TOURNAMENT_TROPHY_ID = '1545550040628461588';
const TOURNAMENT_TROPHY_NAME = 'Trophy_fixed';
const GIVEAWAY_EMOJI_ID = '1540636417577721927';
const GIVEAWAY_EMOJI_NAME = 'giveaway';
const TICKET_EMOJI_ID = '1540639436436406332';
const TICKET_EMOJI_NAME = 'ticket';

// Do not rely on hard-coded emoji markup/component objects alone. Discord can
// silently fall back / fail to render a custom component emoji when the bot has
// stale emoji metadata. We fetch each exact emoji ID at startup and use the
// GuildEmoji's real name + animated flag everywhere (text AND buttons).
const CUSTOM_EMOJI_SPECS = {
  trophy: { id: TOURNAMENT_TROPHY_ID, name: TOURNAMENT_TROPHY_NAME, animated: true },
  giveaway: { id: GIVEAWAY_EMOJI_ID, name: GIVEAWAY_EMOJI_NAME, animated: false },
  ticket: { id: TICKET_EMOJI_ID, name: TICKET_EMOJI_NAME, animated: false },
};
const resolvedCustomEmojis = new Map();

function customEmojiText(key) {
  const emoji = resolvedCustomEmojis.get(key);
  const spec = CUSTOM_EMOJI_SPECS[key];
  if (emoji) return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  return `<${spec.animated ? 'a' : ''}:${spec.name}:${spec.id}>`;
}

function customEmojiComponent(key) {
  const emoji = resolvedCustomEmojis.get(key);
  const spec = CUSTOM_EMOJI_SPECS[key];
  return emoji
    ? { id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated) }
    : { id: spec.id, name: spec.name, animated: Boolean(spec.animated) };
}

async function resolveConfiguredCustomEmojis() {
  resolvedCustomEmojis.clear();

  const guilds = [];
  const primary = client.guilds.cache.get(CONFIG.guildId) || await client.guilds.fetch(CONFIG.guildId).catch(() => null);
  if (primary) guilds.push(primary);
  for (const guild of client.guilds.cache.values()) {
    if (!guilds.some(g => g.id === guild.id)) guilds.push(guild);
  }

  for (const guild of guilds) {
    const emojis = await guild.emojis.fetch().catch(error => {
      console.warn(`[EMOJI] Could not fetch emojis from ${guild.name || guild.id}:`, error?.message || error);
      return null;
    });
    if (!emojis) continue;

    for (const [key, spec] of Object.entries(CUSTOM_EMOJI_SPECS)) {
      if (resolvedCustomEmojis.has(key)) continue;
      const emoji = emojis.get(spec.id);
      if (emoji) resolvedCustomEmojis.set(key, emoji);
    }
  }

  for (const [key, spec] of Object.entries(CUSTOM_EMOJI_SPECS)) {
    const emoji = resolvedCustomEmojis.get(key);
    if (emoji) {
      console.log(`[EMOJI] ${key}: resolved ${emoji.toString()} from ${emoji.guild?.name || emoji.guild?.id || 'a connected guild'}`);
    } else {
      console.warn(`[EMOJI] ${key}: ID ${spec.id} was NOT found in any server this bot can access. Discord cannot render it as a bot custom emoji until the bot can access the emoji's server.`);
    }
  }
}
const TOURNAMENT_HISTORY_LIMIT = 50;
const TOURNAMENT_TURN_MS = 30_000;
const DISCORD_LINK_EXEMPT_CATEGORY_IDS = new Set([
  '1537689865666166859',
  '1537689865666166861',
  '1542835269240094730',
  '1544254003636994048',
]);
const CHAT_DROP_MAX = 999_999;
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
// If a Railway Volume has just been mounted, migrate the old local state once
// so the first persistent deployment does not start from a blank database.
if (STATE_FILE !== LEGACY_STATE_FILE && !fs.existsSync(STATE_FILE) && fs.existsSync(LEGACY_STATE_FILE)) {
  try {
    fs.copyFileSync(LEGACY_STATE_FILE, STATE_FILE);
    console.log(`[STATE] Migrated legacy state to persistent data directory: ${DATA_DIR}`);
  } catch (error) {
    console.error('[STATE] Could not migrate legacy state file:', error);
  }
}

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
    .setName('tournamentsetup')
    .setDescription('Create or repair the customer-only PvP tournament channel and Champion role.')
    .addStringOption(o => o.setName('channel_name').setDescription('Optional tournament channel name.').setMinLength(2).setMaxLength(80))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tournamentprize')
    .setDescription('Set the prize shown for a PvP tournament game.')
    .addStringOption(o => o.setName('game').setDescription('Tournament game pool to configure.').setRequired(true).addChoices(
      { name: 'Mixed PvP Games', value: 'mixed' },
      { name: 'Tic-Tac-Toe Only', value: 'tictactoe' },
      { name: 'Rock Paper Scissors Only', value: 'rps' },
    ))
    .addStringOption(o => o.setName('prize').setDescription('Prize text, e.g. 500,000 Bloxburg Cash.').setRequired(true).setMinLength(1).setMaxLength(200))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tournamentdaily')
    .setDescription('Configure the automatic daily PvP tournament.')
    .addBooleanOption(o => o.setName('enabled').setDescription('Turn the daily tournament on or off.').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('Local time in HH:MM, e.g. 19:00.').setMinLength(5).setMaxLength(5))
    .addStringOption(o => o.setName('game').setDescription('Daily tournament game pool. Defaults to mixed games.').addChoices(
      { name: 'Mixed PvP Games', value: 'mixed' },
      { name: 'Tic-Tac-Toe Only', value: 'tictactoe' },
      { name: 'Rock Paper Scissors Only', value: 'rps' },
    ))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tournamentstart')
    .setDescription('Open registration for a PvP tournament now.')
    .addStringOption(o => o.setName('game').setDescription('Game pool. Defaults to Mixed PvP Games.').addChoices(
      { name: 'Mixed PvP Games', value: 'mixed' },
      { name: 'Tic-Tac-Toe Only', value: 'tictactoe' },
      { name: 'Rock Paper Scissors Only', value: 'rps' },
    ))
    .addStringOption(o => o.setName('prize').setDescription('Optional one-time prize override.').setMaxLength(200))
    .addIntegerOption(o => o.setName('registration_minutes').setDescription('Registration window.').setMinValue(1).setMaxValue(60))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tournamentbegin')
    .setDescription('Close tournament registration and begin the bracket immediately.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tournamentstatus')
    .setDescription('Show the daily tournament configuration and current tournament status.'),

  new SlashCommandBuilder()
    .setName('tournamenthistory')
    .setDescription('Show recently completed or cancelled PvP tournaments.')
    .addIntegerOption(o => o.setName('limit').setDescription('How many recent tournaments to show.').setMinValue(1).setMaxValue(20))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tournamentcancel')
    .setDescription('Cancel the current tournament and close tournament chat.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('chatdrops')
    .setDescription('Manage random daily Bloxburg cash drops.')
    .addSubcommand(s => s
      .setName('start')
      .setDescription('Enable one random cash drop per day.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for drops. Defaults to this channel.').addChannelTypes(ChannelType.GuildText))
      .addIntegerOption(o => o.setName('minimum').setDescription('Minimum cash amount.').setMinValue(1).setMaxValue(CHAT_DROP_MAX))
      .addIntegerOption(o => o.setName('maximum').setDescription('Maximum cash amount. Must stay under 1,000,000.').setMinValue(1).setMaxValue(CHAT_DROP_MAX)))
    .addSubcommand(s => s.setName('stop').setDescription('Disable automatic daily cash drops.'))
    .addSubcommand(s => s.setName('status').setDescription('Show the current chat-drop configuration.'))
    .addSubcommand(s => s
      .setName('now')
      .setDescription('Send a cash drop immediately.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for this drop. Defaults to configured/current channel.').addChannelTypes(ChannelType.GuildText))
      .addIntegerOption(o => o.setName('amount').setDescription('Exact amount, otherwise a configured random amount.').setMinValue(1).setMaxValue(CHAT_DROP_MAX)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('faqadd')
    .setDescription('Add a question and answer to the auto-created FAQ channel.')
    .addStringOption(o => o.setName('question').setDescription('FAQ question.').setRequired(true).setMinLength(2).setMaxLength(250))
    .addStringOption(o => o.setName('answer').setDescription('FAQ answer.').setRequired(true).setMinLength(1).setMaxLength(1200))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('faqedit')
    .setDescription('Edit an existing FAQ question or answer.')
    .addIntegerOption(o => o.setName('number').setDescription('FAQ number.').setRequired(true).setMinValue(1).setMaxValue(50))
    .addStringOption(o => o.setName('question').setDescription('New question text.').setMinLength(2).setMaxLength(250))
    .addStringOption(o => o.setName('answer').setDescription('New answer text.').setMinLength(1).setMaxLength(1200))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('faqremove')
    .setDescription('Remove a question from the FAQ channel.')
    .addIntegerOption(o => o.setName('number').setDescription('FAQ number to remove.').setRequired(true).setMinValue(1).setMaxValue(50))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('faqlist')
    .setDescription('List the saved FAQ entries.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('faqrefresh')
    .setDescription('Rebuild the public FAQ message and ticket button.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('emojicheck')
    .setDescription('Check whether the bot can access the configured custom emoji IDs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmpollcreate')
    .setDescription('Create a saved DM poll draft.')
    .addStringOption(o => o.setName('name').setDescription('Short internal poll name.').setRequired(true).setMinLength(2).setMaxLength(40))
    .addStringOption(o => o.setName('title').setDescription('Title members see in the DM.').setRequired(true).setMinLength(2).setMaxLength(100))
    .addStringOption(o => o.setName('description').setDescription('Optional introduction shown before they start.').setMaxLength(1200))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmquestion')
    .setDescription('Add a question to a saved DM poll.')
    .addStringOption(o => o.setName('poll').setDescription('Poll ID or exact poll name.').setRequired(true).setMaxLength(40))
    .addStringOption(o => o.setName('question').setDescription('Question to ask.').setRequired(true).setMinLength(2).setMaxLength(300))
    .addStringOption(o => o
      .setName('type')
      .setDescription('How members answer this question.')
      .setRequired(true)
      .addChoices(
        { name: 'Pick one answer', value: 'choice' },
        { name: 'Pick multiple answers', value: 'multiple' },
        { name: 'Type an answer', value: 'text' },
        { name: 'Yes or No', value: 'yes_no' },
        { name: 'Rating 1 to 5', value: 'rating' },
      ))
    .addStringOption(o => o.setName('options').setDescription('For pick questions: separate answers with commas or | characters.').setMaxLength(1200))
    .addBooleanOption(o => o.setName('required').setDescription('Require an answer before continuing. Defaults to yes.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmquestionremove')
    .setDescription('Remove a question from a saved DM poll.')
    .addStringOption(o => o.setName('poll').setDescription('Poll ID or exact poll name.').setRequired(true).setMaxLength(40))
    .addIntegerOption(o => o.setName('number').setDescription('Question number to remove.').setRequired(true).setMinValue(1).setMaxValue(10))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmpollview')
    .setDescription('Preview a saved DM poll and its questions.')
    .addStringOption(o => o.setName('poll').setDescription('Poll ID or exact poll name.').setRequired(true).setMaxLength(40))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmpolllist')
    .setDescription('List saved DM polls and response counts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmallpoll')
    .setDescription('DM a saved interactive poll to everyone or one specific role.')
    .addStringOption(o => o.setName('poll').setDescription('Poll ID or exact poll name.').setRequired(true).setMaxLength(40))
    .addRoleOption(o => o.setName('role').setDescription('Optional role. If omitted, every non-bot member is targeted.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmpollresults')
    .setDescription('Post the latest aggregate poll data to the private results channel.')
    .addStringOption(o => o.setName('poll').setDescription('Poll ID or exact poll name.').setRequired(true).setMaxLength(40))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmpollexport')
    .setDescription('Export all poll responses as CSV to the private results channel.')
    .addStringOption(o => o.setName('poll').setDescription('Poll ID or exact poll name.').setRequired(true).setMaxLength(40))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmpollclose')
    .setDescription('Close a poll so no more responses can be submitted.')
    .addStringOption(o => o.setName('poll').setDescription('Poll ID or exact poll name.').setRequired(true).setMaxLength(40))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setpollchannel')
    .setDescription('Choose the private channel used for DM poll response data.')
    .addChannelOption(o => o.setName('channel').setDescription('Private text channel for poll data.').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dmall')
    .setDescription('DM a plain-text announcement to all members or one role.')
    .addStringOption(o => o.setName('message').setDescription('Plain-text message to send.').setRequired(true).setMinLength(1).setMaxLength(2000))
    .addRoleOption(o => o.setName('role').setDescription('Optional role. Only members with this role will be DMed.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`[READY] Logged in as ${client.user.tag}`);

  // Resolve the exact GuildEmoji objects before any V2 panels are rebuilt.
  // This is what makes the ticket/giveaway/trophy render as the real custom
  // server emoji instead of relying on stale hard-coded metadata.
  await resolveConfiguredCustomEmojis();

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

  // Keep DM poll analytics zero-setup. The private results channel is created
  // as soon as the bot is ready, even before the first poll is broadcast.
  try {
    const guild = await client.guilds.fetch(CONFIG.guildId);
    const pollChannel = await ensurePollResultsChannel(guild);
    console.log(`[DM POLL] Private results channel ready: #${pollChannel.name} (${pollChannel.id})`);
  } catch (error) {
    console.error('[DM POLL] Could not prepare the private results channel:', error);
  }

  try {
    const guild = await client.guilds.fetch(CONFIG.guildId);
    const { channel, role } = await ensureTournamentInfrastructure(guild);
    if (state.tournaments?.active && ['finished', 'cancelled'].includes(state.tournaments.active.status)) {
      archiveTournament(state.tournaments.active);
      saveState();
    }
    await syncTournamentChannelMode(guild, channel);
    console.log(`[TOURNAMENT] Ready: #${channel.name} | ${role.name}`);
    await ensureFaqChannel(guild);
    await refreshFaqMessage(guild);
  } catch (error) {
    console.error('[SETUP] Tournament/FAQ auto-setup failed:', error);
  }

  ensureTournamentSchedule();
  if (state.chatDrops?.enabled && !state.chatDrops.nextDropAt) scheduleNextChatDrop(false);
  setInterval(checkTournamentSchedule, 15_000).unref();
  setInterval(checkTournamentTurnTimers, 2_000).unref();
  setInterval(checkChatDrops, 30_000).unref();
  await checkTournamentSchedule();
  await checkTournamentTurnTimers();
  await checkChatDrops();
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


client.on('channelDelete', async channel => {
  if (channel.guild?.id !== CONFIG.guildId) return;

  const wasTournament = channel.id === state.tournaments?.channelId;
  const wasFaq = channel.id === state.faq?.channelId;
  if (wasTournament) {
    state.tournaments.channelId = null;
    saveState();
    setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(CONFIG.guildId);
        await ensureTournamentInfrastructure(guild);
      } catch (error) { console.error('[TOURNAMENT] Failed to recreate deleted tournament channel:', error); }
    }, 1500).unref();
  }
  if (wasFaq) {
    state.faq.channelId = null;
    state.faq.messageId = null;
    saveState();
    setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(CONFIG.guildId);
        await ensureFaqChannel(guild);
        await refreshFaqMessage(guild);
      } catch (error) { console.error('[FAQ] Failed to recreate deleted FAQ channel:', error); }
    }, 1500).unref();
  }

  const wasPollResults = channel.id === state.pollResultsChannelId || channel.id === CONFIG.pollResultsChannelId;
  if (!wasPollResults) return;

  // If the private poll-results channel is ever deleted, forget the stale ID
  // and automatically replace it so future submissions never disappear.
  if (state.pollResultsChannelId === channel.id) {
    state.pollResultsChannelId = null;
    saveState();
  }

  setTimeout(async () => {
    try {
      const guild = await client.guilds.fetch(CONFIG.guildId);
      const replacement = await ensurePollResultsChannel(guild);
      console.log(`[DM POLL] Recreated private results channel: #${replacement.name} (${replacement.id})`);
    } catch (error) {
      console.error('[DM POLL] Failed to recreate deleted results channel:', error);
    }
  }, 1500).unref();
});


function findActiveTournamentMatchByThreadId(threadId) {
  const active = state.tournaments?.active;
  if (!active || active.status !== 'running' || !threadId) return null;
  return Object.values(active.matches || {}).find(match => String(match?.threadId || '') === String(threadId)) || null;
}

async function moderateTournamentThreadMessage(message) {
  if (!message?.guild || !message.channel?.isThread?.()) return false;
  const match = findActiveTournamentMatchByThreadId(message.channel.id);
  if (!match) return false;
  if ([match.p1, match.p2].includes(message.author.id)) return false;
  const member = message.member;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator) || member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return false;
  await message.delete().catch(() => {});
  return true;
}

client.on('messageCreate', async message => {
  if (message.author?.bot) return;

  // Direct messages do not belong to a guild. Log them separately instead of
  // passing them through the guild automod/censor pipeline.
  if (!message.guild) {
    await logIncomingDM(message).catch(error => console.error('[DM LOG] Incoming DM log failed:', error));
    return;
  }

  if (await moderateTournamentThreadMessage(message).catch(error => { console.error('[TOURNAMENT] Thread moderation failed:', error); return false; })) return;
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
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('dmpoll:')) return handleDmPollButton(interaction);
      if (interaction.customId.startsWith('tour:')) return handleTournamentButton(interaction);
      if (interaction.customId.startsWith('chatdrop:')) return handleChatDropButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('dmpoll:')) return handleDmPollSelect(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('dmpoll:')) return handleDmPollModal(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild() || interaction.guildId !== CONFIG.guildId) return;

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
      case 'tournamentsetup': return handleTournamentSetup(interaction);
      case 'tournamentprize': return handleTournamentPrize(interaction);
      case 'tournamentdaily': return handleTournamentDaily(interaction);
      case 'tournamentstart': return handleTournamentStart(interaction);
      case 'tournamentbegin': return handleTournamentBegin(interaction);
      case 'tournamentstatus': return handleTournamentStatus(interaction);
      case 'tournamenthistory': return handleTournamentHistory(interaction);
      case 'tournamentcancel': return handleTournamentCancel(interaction);
      case 'chatdrops': return handleChatDrops(interaction);
      case 'faqadd': return handleFaqAdd(interaction);
      case 'faqedit': return handleFaqEdit(interaction);
      case 'faqremove': return handleFaqRemove(interaction);
      case 'faqlist': return handleFaqList(interaction);
      case 'faqrefresh': return handleFaqRefresh(interaction);
      case 'emojicheck': return handleEmojiCheck(interaction);
      case 'dmpollcreate': return handleDmPollCreate(interaction);
      case 'dmquestion': return handleDmQuestion(interaction);
      case 'dmquestionremove': return handleDmQuestionRemove(interaction);
      case 'dmpollview': return handleDmPollView(interaction);
      case 'dmpolllist': return handleDmPollList(interaction);
      case 'dmallpoll': return handleDmAllPoll(interaction);
      case 'dmpollresults': return handleDmPollResults(interaction);
      case 'dmpollexport': return handleDmPollExport(interaction);
      case 'dmpollclose': return handleDmPollClose(interaction);
      case 'setpollchannel': return handleSetPollChannel(interaction);
      case 'dmall': return handleDmAll(interaction);
      default: return;
    }
  } catch (error) {
    console.error(`[INTERACTION] ${interaction.commandName || interaction.customId || interaction.type} failed:`, error);
    const payload = v2Payload({
      title: 'Command Failed',
      description: `Something went wrong while running this command.\n\n\`${truncate(error?.message || String(error), 700)}\``,
      accentColor: 0xED4245,
      ephemeral: interaction.isChatInputCommand?.() ? true : false,
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
  const linkCategoryExempt = channelIsInDiscordLinkExemptCategory(message.channel);
  const discordLink = !staffLinkBypass && !linkCategoryExempt && channelIsInLockdownCategory(message.channel) && containsDiscordLink(message.content);
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

function channelCategoryId(channel) {
  if (!channel) return null;
  // Normal guild channels point directly at their category. Threads point at
  // their parent text channel, whose parentId is the category.
  if (channel.isThread?.()) return channel.parent?.parentId || null;
  return channel.parentId || null;
}

function channelIsInLockdownCategory(channel) {
  return channelCategoryId(channel) === CONFIG.lockdownCategoryId;
}

function channelIsInDiscordLinkExemptCategory(channel) {
  const categoryId = channelCategoryId(channel);
  return Boolean(categoryId && DISCORD_LINK_EXEMPT_CATEGORY_IDS.has(String(categoryId)));
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
  const width = 1320;
  const height = 760;
  const pixels = Buffer.alloc(width * height * 4);

  const COLORS = {
    bg: [24, 25, 28, 255],
    panel: [35, 36, 40, 255],
    card: [43, 45, 49, 255],
    grid: [63, 65, 72, 255],
    axis: [112, 115, 124, 255],
    text: [242, 243, 245, 255],
    muted: [177, 180, 188, 255],
    join: [88, 101, 242, 255],
    leave: [237, 66, 69, 255],
    positive: [87, 242, 135, 255],
    negative: [242, 112, 112, 255],
  };

  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = COLORS.bg[0];
    pixels[i * 4 + 1] = COLORS.bg[1];
    pixels[i * 4 + 2] = COLORS.bg[2];
    pixels[i * 4 + 3] = 255;
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

  // Compact 5x7 bitmap font so the generated PNG has real labels and values
  // without adding a native canvas dependency to Railway.
  const FONT = {
    'A':['01110','10001','10001','11111','10001','10001','10001'],
    'B':['11110','10001','10001','11110','10001','10001','11110'],
    'C':['01111','10000','10000','10000','10000','10000','01111'],
    'D':['11110','10001','10001','10001','10001','10001','11110'],
    'E':['11111','10000','10000','11110','10000','10000','11111'],
    'F':['11111','10000','10000','11110','10000','10000','10000'],
    'G':['01111','10000','10000','10111','10001','10001','01111'],
    'H':['10001','10001','10001','11111','10001','10001','10001'],
    'I':['11111','00100','00100','00100','00100','00100','11111'],
    'J':['00111','00010','00010','00010','00010','10010','01100'],
    'K':['10001','10010','10100','11000','10100','10010','10001'],
    'L':['10000','10000','10000','10000','10000','10000','11111'],
    'M':['10001','11011','10101','10101','10001','10001','10001'],
    'N':['10001','11001','10101','10011','10001','10001','10001'],
    'O':['01110','10001','10001','10001','10001','10001','01110'],
    'P':['11110','10001','10001','11110','10000','10000','10000'],
    'Q':['01110','10001','10001','10001','10101','10010','01101'],
    'R':['11110','10001','10001','11110','10100','10010','10001'],
    'S':['01111','10000','10000','01110','00001','00001','11110'],
    'T':['11111','00100','00100','00100','00100','00100','00100'],
    'U':['10001','10001','10001','10001','10001','10001','01110'],
    'V':['10001','10001','10001','10001','10001','01010','00100'],
    'W':['10001','10001','10001','10101','10101','10101','01010'],
    'X':['10001','10001','01010','00100','01010','10001','10001'],
    'Y':['10001','10001','01010','00100','00100','00100','00100'],
    'Z':['11111','00001','00010','00100','01000','10000','11111'],
    '0':['01110','10001','10011','10101','11001','10001','01110'],
    '1':['00100','01100','00100','00100','00100','00100','01110'],
    '2':['01110','10001','00001','00010','00100','01000','11111'],
    '3':['11110','00001','00001','01110','00001','00001','11110'],
    '4':['00010','00110','01010','10010','11111','00010','00010'],
    '5':['11111','10000','10000','11110','00001','00001','11110'],
    '6':['01110','10000','10000','11110','10001','10001','01110'],
    '7':['11111','00001','00010','00100','01000','01000','01000'],
    '8':['01110','10001','10001','01110','10001','10001','01110'],
    '9':['01110','10001','10001','01111','00001','00001','01110'],
    '+':['00000','00100','00100','11111','00100','00100','00000'],
    '-':['00000','00000','00000','11111','00000','00000','00000'],
    ':':['00000','00100','00100','00000','00100','00100','00000'],
    '/':['00001','00010','00010','00100','01000','01000','10000'],
    '.':['00000','00000','00000','00000','00000','00100','00100'],
    ' ':['00000','00000','00000','00000','00000','00000','00000'],
  };

  const textWidth = (text, scale = 1) => Math.max(0, String(text).length * 6 * scale - scale);
  const drawText = (text, x, y, scale = 1, color = COLORS.text, align = 'left') => {
    const value = String(text).toUpperCase();
    let xx = x;
    if (align === 'center') xx -= textWidth(value, scale) / 2;
    if (align === 'right') xx -= textWidth(value, scale);
    for (const ch of value) {
      const glyph = FONT[ch] || FONT[' '];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === '1') rect(xx + col * scale, y + row * scale, scale, scale, color);
        }
      }
      xx += 6 * scale;
    }
  };

  const totals = buckets.reduce((acc, b) => ({ joins: acc.joins + b.joins, leaves: acc.leaves + b.leaves }), { joins: 0, leaves: 0 });
  const net = totals.joins - totals.leaves;
  const peakJoin = buckets.reduce((best, b) => b.joins > best.joins ? b : best, buckets[0] || { joins: 0, label: '-' });
  const peakLeave = buckets.reduce((best, b) => b.leaves > best.leaves ? b : best, buckets[0] || { leaves: 0, label: '-' });

  // Header and summary cards.
  drawText('SERVER GROWTH', 42, 28, 4, COLORS.text);
  drawText(`LAST ${buckets.length} DAYS`, 44, 67, 2, COLORS.muted);

  const cards = [
    { label: 'JOINS', value: totals.joins, color: COLORS.join },
    { label: 'LEAVES', value: totals.leaves, color: COLORS.leave },
    { label: 'NET', value: formatSigned(net), color: net >= 0 ? COLORS.positive : COLORS.negative },
    { label: 'PEAK JOIN', value: peakJoin?.joins || 0, color: COLORS.text },
  ];
  const cardY = 105, cardH = 76, cardGap = 14, cardW = (width - 84 - cardGap * 3) / 4;
  cards.forEach((card, i) => {
    const x = 42 + i * (cardW + cardGap);
    rect(x, cardY, cardW, cardH, COLORS.card);
    rect(x, cardY, 4, cardH, card.color);
    drawText(card.label, x + 18, cardY + 14, 2, COLORS.muted);
    drawText(String(card.value), x + 18, cardY + 42, 3, card.color);
  });

  const margin = { left: 92, right: 42, top: 222, bottom: 105 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  rect(margin.left, margin.top, chartW, chartH, COLORS.panel);

  const rawMax = Math.max(1, ...buckets.flatMap(b => [b.joins, b.leaves]));
  // Keep the scale tight enough that small servers do not get tiny bars while
  // still using clean, readable 5-step axis values.
  const axisMax = rawMax <= 5 ? 5
    : rawMax <= 10 ? 10
      : rawMax <= 25 ? 25
        : rawMax <= 50 ? 50
          : Math.ceil(rawMax / 50) * 50;

  // Y axis/grid labels.
  for (let i = 0; i <= 5; i++) {
    const value = Math.round(axisMax * (5 - i) / 5);
    const y = margin.top + chartH * (i / 5);
    rect(margin.left, y, chartW, i === 5 ? 2 : 1, i === 5 ? COLORS.axis : COLORS.grid);
    drawText(String(value), margin.left - 12, y - 4, 1, COLORS.muted, 'right');
  }

  const groupW = chartW / Math.max(1, buckets.length);
  const gap = Math.max(1, groupW * 0.10);
  const barW = Math.max(2, Math.min(22, (groupW - gap * 3) / 2));

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const center = margin.left + i * groupW + groupW / 2;
    const jx = center - gap / 2 - barW;
    const lx = center + gap / 2;
    const jh = (b.joins / axisMax) * (chartH - 20);
    const lh = (b.leaves / axisMax) * (chartH - 20);
    const jy = margin.top + chartH - jh;
    const ly = margin.top + chartH - lh;

    if (b.joins > 0) rect(jx, jy, barW, jh, COLORS.join);
    if (b.leaves > 0) rect(lx, ly, barW, lh, COLORS.leave);

    // Numeric values directly on the graph. Zeroes are still shown lightly so
    // every day has explicit data instead of an ambiguous blank bar.
    const valueScale = buckets.length <= 14 ? 2 : 1;
    drawText(String(b.joins), jx + barW / 2, Math.max(margin.top + 4, jy - (valueScale === 2 ? 18 : 10)), valueScale, b.joins ? COLORS.text : COLORS.muted, 'center');
    drawText(String(b.leaves), lx + barW / 2, Math.max(margin.top + 4, ly - (valueScale === 2 ? 18 : 10)), valueScale, b.leaves ? COLORS.text : COLORS.muted, 'center');
  }

  // Date labels: every day for 7d, every other day for 14d, and roughly weekly
  // for 30d so the graph remains readable on mobile.
  const labelEvery = buckets.length <= 7 ? 1 : buckets.length <= 14 ? 2 : 5;
  buckets.forEach((b, i) => {
    if (i % labelEvery !== 0 && i !== buckets.length - 1) return;
    const center = margin.left + i * groupW + groupW / 2;
    drawText(String(b.label).replace(',', ''), center, margin.top + chartH + 18, buckets.length <= 14 ? 2 : 1, COLORS.muted, 'center');
  });

  // Legend/footer.
  const legendY = height - 44;
  rect(42, legendY, 14, 14, COLORS.join);
  drawText('JOINS', 66, legendY + 1, 2, COLORS.text);
  rect(155, legendY, 14, 14, COLORS.leave);
  drawText('LEAVES', 179, legendY + 1, 2, COLORS.text);
  drawText(`PEAK LEAVE ${peakLeave?.leaves || 0}`, width - 42, legendY + 1, 2, COLORS.muted, 'right');

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
  const peakJoin = buckets.reduce((best, b) => b.joins > best.joins ? b : best, buckets[0] || { joins: 0, label: 'Unknown' });
  const peakLeave = buckets.reduce((best, b) => b.leaves > best.leaves ? b : best, buckets[0] || { leaves: 0, label: 'Unknown' });
  const avgJoins = buckets.length ? (totals.joins / buckets.length).toFixed(1) : '0.0';
  const avgLeaves = buckets.length ? (totals.leaves / buckets.length).toFixed(1) : '0.0';
  const png = renderActivityGraphPng(buckets);
  const attachment = new AttachmentBuilder(png, { name: `server-growth-${days}d.png` });
  const trackingSince = state.memberActivity?.trackingSince || Date.now();
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# Server Growth - ${days} Days\n` +
      `**Period:** ${buckets[0]?.label || 'Unknown'} - ${buckets.at(-1)?.label || 'Unknown'} (UTC)\n` +
      `**Joins:** ${totals.joins}  •  **Leaves:** ${totals.leaves}  •  **Net:** ${formatSigned(totals.joins - totals.leaves)}\n` +
      `**Daily Average:** ${avgJoins} joins  •  ${avgLeaves} leaves\n` +
      `**Peak Join Day:** ${peakJoin.label} (${peakJoin.joins})  •  **Peak Leave Day:** ${peakLeave.label} (${peakLeave.leaves})\n\n` +
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
      `**Version**\n2.8.0\n\n` +
      `**Uptime**\n${formatDurationFriendly(uptime)}\n\n` +
      `**Online Since**\n<t:${Math.floor(startedAt / 1000)}:F> (<t:${Math.floor(startedAt / 1000)}:R>)\n\n` +
      `**Registered Commands**\n${commands.length}\n\n` +
      `**Server**\n${escapeMassMentions(guild.name)} (\`${guild.id}\`)`,
  }));
}


function parsePollOptions(value) {
  return [...new Set(String(value || '')
    .split(/[|,\n]+/g)
    .map(v => v.trim())
    .filter(Boolean))]
    .slice(0, 25)
    .map(v => truncate(v, 100));
}

function findDmPoll(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const direct = state.dmPolls?.[raw.toUpperCase()];
  if (direct) return direct;
  const lower = raw.toLowerCase();
  return Object.values(state.dmPolls || {}).find(p => String(p?.name || '').toLowerCase() === lower) || null;
}

function normalizePollState(poll) {
  poll.questions = Array.isArray(poll.questions) ? poll.questions : [];
  poll.responses = poll.responses && typeof poll.responses === 'object' ? poll.responses : {};
  poll.broadcasts = Array.isArray(poll.broadcasts) ? poll.broadcasts : [];
  poll.status ||= 'draft';
  return poll;
}

function pollQuestionTypeLabel(type) {
  return ({
    choice: 'Pick one',
    multiple: 'Pick multiple',
    text: 'Written answer',
    yes_no: 'Yes / No',
    rating: 'Rating 1-5',
  })[type] || type;
}

function pollQuestionOptions(question) {
  if (question.type === 'yes_no') return ['Yes', 'No'];
  if (question.type === 'rating') return ['1', '2', '3', '4', '5'];
  return Array.isArray(question.options) ? question.options : [];
}

function getPollResponse(poll, userId, create = true) {
  normalizePollState(poll);
  let response = poll.responses[userId];
  if (!response && create) {
    response = {
      deliveredAt: Date.now(),
      startedAt: null,
      answers: {},
      submittedAt: null,
    };
    poll.responses[userId] = response;
  }
  if (response) {
    response.answers = response.answers && typeof response.answers === 'object' ? response.answers : {};
  }
  return response || null;
}

function formatPollAnswer(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'No answer';
  if (value === null || value === undefined || value === '') return 'No answer';
  return String(value);
}

function makePollStartPayload(poll) {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${escapeMassMentions(poll.title)}\n` +
      `${poll.description ? `${escapeMassMentions(poll.description)}\n\n` : ''}` +
      `**Questions:** ${poll.questions.length}\n` +
      `-# Your answers are sent privately to the server's poll-results channel after you submit.`
    )
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dmpoll:start:${poll.id}`)
      .setLabel('Start Poll')
      .setStyle(ButtonStyle.Primary)
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function makePollQuestionPayload(poll, questionIndex) {
  if (questionIndex >= poll.questions.length) return makePollReviewPayload(poll);
  const question = poll.questions[questionIndex];
  const requiredText = question.required ? 'Required' : 'Optional';
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${escapeMassMentions(poll.title)}\n` +
      `**Question ${questionIndex + 1} of ${poll.questions.length}**\n` +
      `${escapeMassMentions(question.text)}\n\n` +
      `-# ${pollQuestionTypeLabel(question.type)} • ${requiredText}`
    )
  );

  const rows = [];
  if (question.type === 'text') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dmpoll:text:${poll.id}:${question.id}`)
        .setLabel('Type Answer')
        .setStyle(ButtonStyle.Primary)
    );
    if (!question.required) {
      row.addComponents(new ButtonBuilder()
        .setCustomId(`dmpoll:skip:${poll.id}:${question.id}`)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary));
    }
    rows.push(row);
  } else {
    const options = pollQuestionOptions(question);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`dmpoll:select:${poll.id}:${question.id}`)
      .setPlaceholder(question.type === 'multiple' ? 'Choose one or more answers' : 'Choose an answer')
      .setMinValues(1)
      .setMaxValues(question.type === 'multiple' ? Math.max(1, options.length) : 1)
      .addOptions(options.map((label, index) => ({ label, value: String(index) })));
    rows.push(new ActionRowBuilder().addComponents(select));
    if (!question.required) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`dmpoll:skip:${poll.id}:${question.id}`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary)
      ));
    }
  }

  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function makePollReviewPayload(poll, response = null) {
  const answered = response ? Object.keys(response.answers || {}).length : 0;
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${escapeMassMentions(poll.title)}\n` +
      `You've reached the end of the poll.\n\n` +
      `**Answered:** ${answered}/${poll.questions.length}\n` +
      `Press **Submit Poll** to send your answers.`
    )
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dmpoll:submit:${poll.id}`)
      .setLabel('Submit Poll')
      .setStyle(ButtonStyle.Success)
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function makePollFinishedPayload(poll) {
  return v2Edit({
    title: 'Poll Submitted',
    description: `Thanks for completing **${poll.title}**. Your response has been recorded.`,
  });
}

function validatePollInteraction(interaction, pollId) {
  const poll = state.dmPolls?.[String(pollId || '').toUpperCase()];
  if (!poll) return { error: 'This poll no longer exists.' };
  normalizePollState(poll);
  const response = getPollResponse(poll, interaction.user.id, false);
  if (!response) return { error: 'This poll was not sent to your account.' };
  if (poll.status === 'closed') return { error: 'This poll has been closed and is no longer accepting responses.' };
  if (response.submittedAt) return { error: 'You already submitted this poll.' };
  return { poll, response };
}

async function handleDmPollButton(interaction) {
  const [, action, pollId, questionId] = interaction.customId.split(':');
  const checked = validatePollInteraction(interaction, pollId);
  if (checked.error) return interaction.reply(v2Payload({ title: 'Poll Unavailable', description: checked.error, ephemeral: true })).catch(() => {});
  const { poll, response } = checked;

  if (action === 'start') {
    response.startedAt ||= Date.now();
    saveState();
    return interaction.update(makePollQuestionPayload(poll, 0));
  }

  if (action === 'skip') {
    const index = poll.questions.findIndex(q => q.id === questionId);
    if (index < 0) return interaction.reply(v2Payload({ title: 'Question Missing', description: 'That question is no longer available.', ephemeral: true }));
    const q = poll.questions[index];
    if (q.required) return interaction.reply(v2Payload({ title: 'Answer Required', description: 'This question cannot be skipped.', ephemeral: true }));
    response.answers[q.id] = { value: null, skipped: true, answeredAt: Date.now() };
    saveState();
    const next = index + 1 >= poll.questions.length ? makePollReviewPayload(poll, response) : makePollQuestionPayload(poll, index + 1);
    return interaction.update(next);
  }

  if (action === 'text') {
    const q = poll.questions.find(q => q.id === questionId);
    if (!q || q.type !== 'text') return interaction.reply(v2Payload({ title: 'Question Missing', description: 'That written question is no longer available.', ephemeral: true }));
    const modal = new ModalBuilder()
      .setCustomId(`dmpoll:modal:${poll.id}:${q.id}`)
      .setTitle(truncate(poll.title, 45));
    const input = new TextInputBuilder()
      .setCustomId('answer')
      .setLabel(truncate(q.text, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(q.required)
      .setMaxLength(1500)
      .setPlaceholder('Type your answer here');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (action === 'submit') {
    const missing = poll.questions.filter(q => q.required && !(q.id in response.answers));
    if (missing.length) {
      return interaction.reply(v2Payload({
        title: 'Missing Required Answers',
        description: `You still need to answer **${missing.length}** required question(s). Re-open the poll DM and start again to complete them.`,
        ephemeral: true,
      }));
    }
    response.submittedAt = Date.now();
    saveState();
    await interaction.update(makePollFinishedPayload(poll));
    await postPollSubmission(poll, interaction.user, response).catch(error => console.error('[DM POLL] Submission log failed:', error));
    await updatePollSummaryMessage(poll).catch(error => console.error('[DM POLL] Summary update failed:', error));
    saveState();
    return;
  }
}

async function handleDmPollSelect(interaction) {
  const [, action, pollId, questionId] = interaction.customId.split(':');
  if (action !== 'select') return;
  const checked = validatePollInteraction(interaction, pollId);
  if (checked.error) return interaction.reply(v2Payload({ title: 'Poll Unavailable', description: checked.error, ephemeral: true })).catch(() => {});
  const { poll, response } = checked;
  const index = poll.questions.findIndex(q => q.id === questionId);
  if (index < 0) return interaction.reply(v2Payload({ title: 'Question Missing', description: 'That question is no longer available.', ephemeral: true }));
  const question = poll.questions[index];
  const options = pollQuestionOptions(question);
  const values = interaction.values.map(v => options[Number(v)]).filter(v => v !== undefined);
  response.answers[question.id] = {
    value: question.type === 'multiple' ? values : (values[0] ?? null),
    answeredAt: Date.now(),
  };
  saveState();
  const next = index + 1 >= poll.questions.length ? makePollReviewPayload(poll, response) : makePollQuestionPayload(poll, index + 1);
  return interaction.update(next);
}

async function handleDmPollModal(interaction) {
  const [, action, pollId, questionId] = interaction.customId.split(':');
  if (action !== 'modal') return;
  const checked = validatePollInteraction(interaction, pollId);
  if (checked.error) return interaction.reply(v2Payload({ title: 'Poll Unavailable', description: checked.error, ephemeral: true })).catch(() => {});
  const { poll, response } = checked;
  const index = poll.questions.findIndex(q => q.id === questionId);
  if (index < 0) return interaction.reply(v2Payload({ title: 'Question Missing', description: 'That question is no longer available.', ephemeral: true }));
  const answer = interaction.fields.getTextInputValue('answer').trim();
  const question = poll.questions[index];
  if (question.required && !answer) return interaction.reply(v2Payload({ title: 'Answer Required', description: 'Please enter an answer for this required question.', ephemeral: true }));
  response.answers[question.id] = { value: answer || null, answeredAt: Date.now() };
  saveState();
  const next = index + 1 >= poll.questions.length ? makePollReviewPayload(poll, response) : makePollQuestionPayload(poll, index + 1);
  if (interaction.message?.editable) {
    await interaction.message.edit(next).catch(() => null);
    return interaction.deferUpdate().catch(() => {});
  }
  return interaction.reply(next);
}

async function handleDmPollCreate(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const name = interaction.options.getString('name', true).trim();
  const title = interaction.options.getString('title', true).trim();
  const description = interaction.options.getString('description')?.trim() || '';
  const duplicate = Object.values(state.dmPolls || {}).find(p => String(p?.name || '').toLowerCase() === name.toLowerCase());
  if (duplicate) return fail(interaction, 'Poll Name Exists', `A poll named **${escapeMassMentions(name)}** already exists with ID \`${duplicate.id}\`.`);
  const id = makeId();
  state.dmPolls ||= {};
  state.dmPolls[id] = {
    id, name, title, description,
    status: 'draft',
    createdAt: Date.now(),
    createdBy: interaction.user.id,
    questions: [], responses: {}, broadcasts: [], summaryMessageId: null,
  };
  saveState();
  return interaction.reply(v2Payload({
    title: 'DM Poll Created',
    description: `**Name:** ${escapeMassMentions(name)}\n**Poll ID:** \`${id}\`\n**Title:** ${escapeMassMentions(title)}\n\nAdd questions with \`/dmquestion\`, then send it with \`/dmallpoll\`.`,
    ephemeral: true,
  }));
}

async function handleDmQuestion(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const poll = findDmPoll(interaction.options.getString('poll', true));
  if (!poll) return fail(interaction, 'Poll Not Found', 'I could not find a poll with that ID or exact name.');
  normalizePollState(poll);
  if (poll.status !== 'draft') return fail(interaction, 'Poll Already Sent', 'Questions are locked after a poll has been broadcast. Create a new poll if you need a different question set.');
  if (poll.questions.length >= 10) return fail(interaction, 'Question Limit', 'A DM poll can have up to 10 questions.');

  const text = interaction.options.getString('question', true).trim();
  const type = interaction.options.getString('type', true);
  const required = interaction.options.getBoolean('required') ?? true;
  let options = [];
  if (type === 'choice' || type === 'multiple') {
    options = parsePollOptions(interaction.options.getString('options'));
    if (options.length < 2) return fail(interaction, 'Missing Answer Options', 'Pick-one and pick-multiple questions need at least 2 comma-separated or | separated options.');
  }
  const question = { id: makeId(), text, type, required, options };
  poll.questions.push(question);
  saveState();
  return interaction.reply(v2Payload({
    title: 'Question Added',
    description: `Added **Question ${poll.questions.length}** to **${escapeMassMentions(poll.name)}**.\n\n**${escapeMassMentions(text)}**\nType: ${pollQuestionTypeLabel(type)}\nRequired: ${required ? 'Yes' : 'No'}${options.length ? `\nOptions: ${escapeMassMentions(options.join(', '))}` : ''}`,
    ephemeral: true,
  }));
}

async function handleDmQuestionRemove(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const poll = findDmPoll(interaction.options.getString('poll', true));
  if (!poll) return fail(interaction, 'Poll Not Found', 'I could not find that poll.');
  normalizePollState(poll);
  if (poll.status !== 'draft') return fail(interaction, 'Poll Already Sent', 'Questions are locked after a poll has been broadcast.');
  const number = interaction.options.getInteger('number', true);
  if (number > poll.questions.length) return fail(interaction, 'Question Not Found', `That poll only has ${poll.questions.length} question(s).`);
  const [removed] = poll.questions.splice(number - 1, 1);
  saveState();
  return interaction.reply(v2Payload({ title: 'Question Removed', description: `Removed **Question ${number}**: ${escapeMassMentions(removed.text)}`, ephemeral: true }));
}

function buildPollPreview(poll) {
  normalizePollState(poll);
  const submitted = Object.values(poll.responses).filter(r => r?.submittedAt).length;
  const delivered = Object.keys(poll.responses).length;
  const lines = poll.questions.length
    ? poll.questions.map((q, i) => `**${i + 1}. ${escapeMassMentions(q.text)}**\n${pollQuestionTypeLabel(q.type)} • ${q.required ? 'Required' : 'Optional'}${pollQuestionOptions(q).length ? ` • ${escapeMassMentions(pollQuestionOptions(q).join(', '))}` : ''}`).join('\n\n')
    : 'No questions added yet.';
  return `**Name:** ${escapeMassMentions(poll.name)}\n**ID:** \`${poll.id}\`\n**Status:** ${poll.status}\n**Delivered:** ${delivered}\n**Submitted:** ${submitted}\n\n${truncate(lines, 2800)}`;
}

async function handleDmPollView(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const poll = findDmPoll(interaction.options.getString('poll', true));
  if (!poll) return fail(interaction, 'Poll Not Found', 'I could not find that poll.');
  return interaction.reply(v2Payload({ title: `DM Poll - ${poll.title}`, description: buildPollPreview(poll), ephemeral: true }));
}

async function handleDmPollList(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const polls = Object.values(state.dmPolls || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!polls.length) return interaction.reply(v2Payload({ title: 'DM Polls', description: 'No saved polls yet. Use `/dmpollcreate` to make one.', ephemeral: true }));
  const body = polls.slice(0, 20).map(p => {
    normalizePollState(p);
    const submitted = Object.values(p.responses).filter(r => r?.submittedAt).length;
    return `**${escapeMassMentions(p.name)}** • \`${p.id}\` • ${p.status} • ${p.questions.length}Q • ${submitted}/${Object.keys(p.responses).length} submitted`;
  }).join('\n');
  return interaction.reply(v2Payload({ title: 'Saved DM Polls', description: body, ephemeral: true }));
}

async function handleSetPollChannel(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const channel = interaction.options.getChannel('channel', true);
  if (channel.type !== ChannelType.GuildText) return fail(interaction, 'Invalid Channel', 'Choose a normal text channel.');
  const everyoneCanView = channel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
  if (everyoneCanView) return fail(interaction, 'Channel Is Public', 'For privacy, the poll-results channel must not be visible to @everyone. Make it private first, then run this command again.');
  state.pollResultsChannelId = channel.id;
  saveState();
  return interaction.reply(v2Payload({ title: 'Poll Results Channel Set', description: `Future DM poll submissions and data will go to ${channel}.`, ephemeral: true }));
}

async function ensurePollResultsChannel(guild) {
  const candidates = [state.pollResultsChannelId, CONFIG.pollResultsChannelId].filter(Boolean);
  for (const id of candidates) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (channel?.type !== ChannelType.GuildText) continue;
    const everyoneCanView = channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
    if (!everyoneCanView) {
      if (state.pollResultsChannelId !== channel.id) {
        state.pollResultsChannelId = channel.id;
        saveState();
      }
      return channel;
    }
    console.warn(`[DM POLL] Configured results channel ${id} is visible to @everyone; refusing to use it for private poll data.`);
  }

  // Recover an existing private channel by name as well. This avoids creating
  // duplicate dm-poll-results channels if Railway restarts without persisted
  // state or the saved channel ID is ever lost.
  const fetched = await guild.channels.fetch().catch(() => guild.channels.cache);
  const existingNamed = fetched.find?.(channel => {
    if (channel?.type !== ChannelType.GuildText || channel.name !== 'dm-poll-results') return false;
    return !channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
  });
  if (existingNamed) {
    state.pollResultsChannelId = existingNamed.id;
    saveState();
    return existingNamed;
  }

  const me = guild.members.me || await guild.members.fetchMe();
  const privateAccess = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: me.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: guild.ownerId, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
  ];
  if (CONFIG.adminAlertRoleId && guild.roles.cache.has(CONFIG.adminAlertRoleId)) {
    privateAccess.push({
      id: CONFIG.adminAlertRoleId,
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name: 'dm-poll-results',
    type: ChannelType.GuildText,
    topic: 'Private DM poll responses, live summaries, and exports.',
    reason: 'Private results channel for DM polls',
    permissionOverwrites: privateAccess,
  });
  state.pollResultsChannelId = channel.id;
  saveState();
  await channel.send(v2Payload({
    title: 'DM Poll Results',
    description: 'This private channel was created automatically for interactive DM poll submissions, summaries, and exports. The bot will recreate it if it is ever deleted.',
  })).catch(() => {});
  return channel;
}

async function handleDmAllPoll(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const poll = findDmPoll(interaction.options.getString('poll', true));
  if (!poll) return fail(interaction, 'Poll Not Found', 'I could not find that poll.');
  normalizePollState(poll);
  if (!poll.questions.length) return fail(interaction, 'No Questions', 'Add at least one question with `/dmquestion` before sending this poll.');
  if (poll.status === 'closed') return fail(interaction, 'Poll Closed', 'This poll is closed. Create a new poll to send another questionnaire.');
  const role = interaction.options.getRole('role');
  const resultsChannel = await ensurePollResultsChannel(interaction.guild);

  await interaction.reply(v2Payload({
    title: 'DM Poll Broadcast Starting',
    description: role ? `Sending **${escapeMassMentions(poll.title)}** to members with ${role}.` : `Sending **${escapeMassMentions(poll.title)}** to every non-bot member.`,
    ephemeral: true,
  }));

  const members = await interaction.guild.members.fetch();
  const targets = [...members.values()].filter(m => !m.user.bot && (!role || m.roles.cache.has(role.id)) && !poll.responses[m.id]);
  if (!targets.length) return interaction.editReply(v2Edit({ title: 'No New Recipients', description: 'Every matching member has already received this poll, or there are no matching members.' }));

  let sent = 0, failed = 0;
  const queue = [...targets];
  const workerCount = Math.min(3, Math.max(1, queue.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const member = queue.shift();
      if (!member) break;
      try {
        await member.send(makePollStartPayload(poll));
        poll.responses[member.id] = { deliveredAt: Date.now(), startedAt: null, answers: {}, submittedAt: null };
        sent++;
      } catch {
        failed++;
      }
    }
  }));

  poll.status = 'active';
  poll.sentAt ||= Date.now();
  poll.broadcasts.push({ at: Date.now(), by: interaction.user.id, roleId: role?.id || null, attempted: targets.length, delivered: sent, failed });
  saveState();
  await updatePollSummaryMessage(poll, resultsChannel).catch(error => console.error('[DM POLL] Could not create summary:', error));
  await logAction({
    title: 'DM Poll Broadcast Complete',
    description: `**${escapeMassMentions(poll.title)}** was broadcast to ${role ? `members with ${role}` : 'all non-bot members'}.`,
    moderator: interaction.user,
    extra: `Poll ID: \`${poll.id}\`\nDelivered: ${sent}\nFailed: ${failed}\nResults: ${resultsChannel}`,
  });
  return interaction.editReply(v2Edit({
    title: 'DM Poll Broadcast Complete',
    description: `**Poll:** ${escapeMassMentions(poll.title)}\n**Delivered:** ${sent}\n**Failed:** ${failed}\n**Attempted:** ${targets.length}\n**Private results:** ${resultsChannel}`,
  }));
}

function pollAggregateText(poll) {
  normalizePollState(poll);
  const responses = Object.entries(poll.responses);
  const submitted = responses.filter(([, r]) => r?.submittedAt);
  const started = responses.filter(([, r]) => r?.startedAt).length;
  const delivered = responses.length;
  const lines = [
    `**Poll ID:** \`${poll.id}\``,
    `**Status:** ${poll.status}`,
    `**Delivered:** ${delivered}`,
    `**Started:** ${started}`,
    `**Submitted:** ${submitted.length}`,
    `**Completion Rate:** ${delivered ? ((submitted.length / delivered) * 100).toFixed(1) : '0.0'}%`,
  ];
  for (let i = 0; i < poll.questions.length; i++) {
    const q = poll.questions[i];
    const values = submitted.map(([, r]) => r.answers?.[q.id]?.value).filter(v => v !== undefined && v !== null && v !== '');
    lines.push(`\n**Q${i + 1}. ${escapeMassMentions(q.text)}**`);
    if (q.type === 'text') {
      lines.push(`${values.length} written response(s)`);
    } else {
      const options = pollQuestionOptions(q);
      for (const option of options) {
        const count = values.reduce((n, value) => n + (Array.isArray(value) ? (value.includes(option) ? 1 : 0) : (value === option ? 1 : 0)), 0);
        const pct = submitted.length ? ((count / submitted.length) * 100).toFixed(1) : '0.0';
        lines.push(`${escapeMassMentions(option)}: **${count}** (${pct}%)`);
      }
    }
  }
  return truncate(lines.join('\n'), 3800);
}

async function updatePollSummaryMessage(poll, channel = null) {
  channel ||= await ensurePollResultsChannel(await client.guilds.fetch(CONFIG.guildId));
  const payload = v2Edit({ title: `Poll Summary - ${poll.title}`, description: pollAggregateText(poll) });
  if (poll.summaryMessageId) {
    const existing = await channel.messages.fetch(poll.summaryMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
  }
  const message = await channel.send({ ...payload, flags: MessageFlags.IsComponentsV2 });
  poll.summaryMessageId = message.id;
  saveState();
  return message;
}

async function postPollSubmission(poll, user, response) {
  const guild = await client.guilds.fetch(CONFIG.guildId);
  const channel = await ensurePollResultsChannel(guild);
  const answerLines = poll.questions.map((q, i) => {
    const answer = response.answers?.[q.id];
    return `**${i + 1}. ${escapeMassMentions(q.text)}**\n${truncate(escapeMassMentions(formatPollAnswer(answer?.value)), 700)}`;
  }).join('\n\n');
  await channel.send(v2Payload({
    title: `Poll Response - ${poll.title}`,
    description: `**User:** <@${user.id}> (\`${user.id}\`)\n**Submitted:** <t:${Math.floor(response.submittedAt / 1000)}:F>\n\n${truncate(answerLines, 3000)}`,
  }));
}

async function handleDmPollResults(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const poll = findDmPoll(interaction.options.getString('poll', true));
  if (!poll) return fail(interaction, 'Poll Not Found', 'I could not find that poll.');
  const channel = await ensurePollResultsChannel(interaction.guild);
  await channel.send(v2Payload({ title: `Poll Results - ${poll.title}`, description: pollAggregateText(poll) }));
  return interaction.reply(v2Payload({ title: 'Poll Results Posted', description: `The latest aggregate data was posted privately in ${channel}.`, ephemeral: true }));
}

function csvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  // Prevent spreadsheet apps from interpreting member-written responses as formulas.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildPollCsv(poll) {
  const header = ['user_id', 'submitted_at', ...poll.questions.map((q, i) => `Q${i + 1}: ${q.text}`)];
  const rows = [header.map(csvCell).join(',')];
  for (const [userId, response] of Object.entries(poll.responses || {})) {
    if (!response?.submittedAt) continue;
    const row = [userId, new Date(response.submittedAt).toISOString()];
    for (const q of poll.questions) row.push(formatPollAnswer(response.answers?.[q.id]?.value));
    rows.push(row.map(csvCell).join(','));
  }
  return Buffer.from(rows.join('\n'), 'utf8');
}

async function handleDmPollExport(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const poll = findDmPoll(interaction.options.getString('poll', true));
  if (!poll) return fail(interaction, 'Poll Not Found', 'I could not find that poll.');
  const channel = await ensurePollResultsChannel(interaction.guild);
  const file = new AttachmentBuilder(buildPollCsv(poll), { name: `poll-${poll.id}-responses.csv` });
  await channel.send({
    components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Poll Export - ${escapeMassMentions(poll.title)}\nFull submitted response data for poll \`${poll.id}\`.`))],
    files: [file], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });
  return interaction.reply(v2Payload({ title: 'Poll Export Ready', description: `The CSV was posted privately in ${channel}.`, ephemeral: true }));
}

async function handleDmPollClose(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const poll = findDmPoll(interaction.options.getString('poll', true));
  if (!poll) return fail(interaction, 'Poll Not Found', 'I could not find that poll.');
  poll.status = 'closed';
  poll.closedAt = Date.now();
  poll.closedBy = interaction.user.id;
  saveState();
  const channel = await ensurePollResultsChannel(interaction.guild);
  await updatePollSummaryMessage(poll, channel).catch(() => {});
  return interaction.reply(v2Payload({ title: 'Poll Closed', description: `**${escapeMassMentions(poll.title)}** is now closed. Existing DM buttons will no longer accept answers.`, ephemeral: true }));
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


// ---------- TOURNAMENTS ----------

function normalizeTournamentState(value, defaults) {
  const source = value && typeof value === 'object' ? value : {};
  const daily = source.daily && typeof source.daily === 'object' ? source.daily : {};
  const normalizedDaily = { ...defaults.daily, ...daily };
  if (normalizedDaily.game === 'rotate') normalizedDaily.game = 'mixed';
  return {
    ...defaults,
    ...source,
    prizes: { ...defaults.prizes, ...(source.prizes || {}) },
    daily: normalizedDaily,
    history: Array.isArray(source.history) ? source.history.slice(-TOURNAMENT_HISTORY_LIMIT) : [],
    chatParticipantIds: Array.isArray(source.chatParticipantIds) ? [...new Set(source.chatParticipantIds.map(String))] : [],
    active: source.active && typeof source.active === 'object' ? source.active : null,
  };
}

function archiveTournament(active) {
  if (!active?.id) return;
  state.tournaments ||= {};
  state.tournaments.history ||= [];
  const snapshot = JSON.parse(JSON.stringify(active));
  const index = state.tournaments.history.findIndex(item => item?.id === active.id);
  if (index >= 0) state.tournaments.history[index] = snapshot;
  else state.tournaments.history.push(snapshot);
  if (state.tournaments.history.length > TOURNAMENT_HISTORY_LIMIT) {
    state.tournaments.history = state.tournaments.history.slice(-TOURNAMENT_HISTORY_LIMIT);
  }
}

function latestTournamentHistory() {
  const history = Array.isArray(state.tournaments?.history) ? state.tournaments.history : [];
  return history.length ? history[history.length - 1] : null;
}

async function ghostPingTournamentChannel(channel) {
  if (!channel?.isTextBased()) return;
  try {
    const ping = await channel.send({
      content: '@everyone',
      allowedMentions: { parse: ['everyone'] },
    });
    setTimeout(() => ping.delete().catch(() => {}), 900);
  } catch (error) {
    console.error('[TOURNAMENT] Ghost ping failed:', error);
  }
}

function tournamentGameName(game) {
  if (game === 'mixed') return 'Mixed PvP';
  return game === 'rps' ? 'Rock Paper Scissors' : 'Tic-Tac-Toe';
}

function tournamentGameEmoji(game) {
  if (game === 'mixed') return '❌ ⭕  •  🪨 📄 ✂️';
  return game === 'rps' ? '🪨 📄 ✂️' : '❌ ⭕';
}

function chooseTournamentMatchGame(active, round, matchNumber) {
  if (active?.game === 'tictactoe' || active?.game === 'rps') return active.game;
  const offset = Number(active?.gameRotationSeed || 0) % 2;
  return ((Number(round || 1) + Number(matchNumber || 1) + offset) % 2 === 0) ? 'tictactoe' : 'rps';
}

function otherTournamentGame(game) {
  return game === 'rps' ? 'tictactoe' : 'rps';
}

async function ensureTournamentInfrastructure(guild) {
  state.tournaments ||= normalizeTournamentState(null, {
    channelId: null, championRoleId: null, channelName: TOURNAMENT_CHANNEL_NAME,
    prizes: { mixed: 'To be announced', tictactoe: 'To be announced', rps: 'To be announced' },
    daily: { enabled: true, time: '19:00', game: 'mixed', nextAt: null, rotationIndex: 0 }, history: [], chatParticipantIds: [], active: null,
  });

  let role = state.tournaments.championRoleId ? guild.roles.cache.get(state.tournaments.championRoleId) : null;
  role ||= guild.roles.cache.find(r => r.name === CHAMPION_ROLE_NAME) || null;
  if (!role) {
    role = await guild.roles.create({
      name: CHAMPION_ROLE_NAME,
      color: 0xF1C40F,
      hoist: false,
      mentionable: false,
      permissions: [],
      reason: 'Auto-created cosmetic tournament champion role',
    });
  }
  state.tournaments.championRoleId = role.id;

  let channel = state.tournaments.channelId ? guild.channels.cache.get(state.tournaments.channelId) : null;
  const wantedName = String(state.tournaments.channelName || TOURNAMENT_CHANNEL_NAME).toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 80) || TOURNAMENT_CHANNEL_NAME;
  channel ||= guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === wantedName) || null;
  if (!channel) {
    channel = await guild.channels.create({
      name: wantedName,
      type: ChannelType.GuildText,
      topic: 'Daily customer PvP tournaments, brackets, prizes and champions.',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: CONFIG.customerRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
        { id: guild.members.me.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] },
      ],
      reason: 'Auto-created PvP tournament channel',
    });
  } else {
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false }, { reason: 'Tournament channel privacy' }).catch(() => {});
    await channel.permissionOverwrites.edit(CONFIG.customerRoleId, { ViewChannel: true, ReadMessageHistory: true, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false }, { reason: 'Tournament customer access' }).catch(() => {});
  }
  state.tournaments.channelId = channel.id;
  saveState();
  return { channel, role };
}

async function setTournamentChannelMode(guild, channel, mode, participantIds = []) {
  if (!channel?.permissionOverwrites || !guild) return;

  const previousIds = Array.isArray(state.tournaments?.chatParticipantIds) ? state.tournaments.chatParticipantIds.map(String) : [];
  for (const userId of previousIds) {
    await channel.permissionOverwrites.delete(userId, 'Reset tournament participant chat access').catch(() => {});
  }

  const celebration = mode === 'celebration';
  await channel.permissionOverwrites.edit(CONFIG.customerRoleId, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: celebration,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
  }, { reason: `PvP tournament channel mode: ${mode}` }).catch(error => console.error('[TOURNAMENT] Customer chat permission update failed:', error));

  const uniqueParticipants = mode === 'running' ? [...new Set((participantIds || []).map(String))] : [];
  for (const userId of uniqueParticipants) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      SendMessagesInThreads: true,
    }, { reason: 'Registered PvP tournament participant' }).catch(error => console.error(`[TOURNAMENT] Participant overwrite failed for ${userId}:`, error));
  }

  state.tournaments.chatParticipantIds = uniqueParticipants;
  saveState();
}

async function syncTournamentChannelMode(guild, channel) {
  const active = state.tournaments?.active;
  if (active?.status === 'running') return setTournamentChannelMode(guild, channel, 'running', active.participants || []);
  if (active?.status === 'registration') return setTournamentChannelMode(guild, channel, 'registration');
  if (active?.status === 'finished') return setTournamentChannelMode(guild, channel, 'celebration');
  return setTournamentChannelMode(guild, channel, 'closed');
}

function parseClockTime(value) {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function zonedParts(timestamp, timeZone = CONFIG.timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(timestamp)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

function timeZoneOffsetMs(timestamp, timeZone = CONFIG.timeZone) {
  const p = zonedParts(timestamp, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(timestamp / 1000) * 1000;
}

function zonedDateTimeToUtcMs(year, month, day, hour, minute, timeZone = CONFIG.timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = guess - timeZoneOffsetMs(guess, timeZone);
  candidate = guess - timeZoneOffsetMs(candidate, timeZone);
  return candidate;
}

function addLocalDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextDailyTimeTimestamp(clock, timeZone = CONFIG.timeZone, from = Date.now()) {
  const parsed = parseClockTime(clock) || { hour: 19, minute: 0 };
  const nowParts = zonedParts(from, timeZone);
  let candidate = zonedDateTimeToUtcMs(nowParts.year, nowParts.month, nowParts.day, parsed.hour, parsed.minute, timeZone);
  if (candidate <= from + 30_000) {
    const tomorrow = addLocalDays(nowParts, 1);
    candidate = zonedDateTimeToUtcMs(tomorrow.year, tomorrow.month, tomorrow.day, parsed.hour, parsed.minute, timeZone);
  }
  return candidate;
}

function ensureTournamentSchedule() {
  const daily = state.tournaments?.daily;
  if (!daily?.enabled) return;
  if (!daily.nextAt || daily.nextAt <= Date.now() - 6 * 60 * 60 * 1000) {
    daily.nextAt = nextDailyTimeTimestamp(daily.time || '19:00');
    saveState();
  }
}

function chooseDailyTournamentGame() {
  const daily = state.tournaments.daily;
  if (['mixed', 'tictactoe', 'rps'].includes(daily.game)) return daily.game;
  return 'mixed';
}

async function checkTournamentSchedule() {
  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (!guild) return;
  const active = state.tournaments?.active;
  if (active?.status === 'registration' && active.registrationClosesAt && Date.now() >= active.registrationClosesAt && !active.transitioning) {
    await beginTournamentBracket(guild).catch(error => console.error('[TOURNAMENT] Auto-begin failed:', error));
  }

  const daily = state.tournaments?.daily;
  if (!daily?.enabled) return;
  ensureTournamentSchedule();
  if (daily.nextAt && Date.now() >= daily.nextAt) {
    daily.nextAt = nextDailyTimeTimestamp(daily.time || '19:00', CONFIG.timeZone, Date.now() + 60_000);
    saveState();
    if (!state.tournaments.active || state.tournaments.active.status === 'finished' || state.tournaments.active.status === 'cancelled') {
      const game = chooseDailyTournamentGame();
      await startTournamentRegistration(guild, game, state.tournaments.prizes?.[game] || 'To be announced', TOURNAMENT_REGISTRATION_MINUTES, 'Daily tournament');
    }
  }
}

function makeTournamentRegistrationPayload(active) {
  const participants = active.participants || [];
  const names = participants.slice(0, 20).map((id, i) => `${i + 1}. <@${id}>`).join('\n') || '*Nobody has joined yet.*';
  const more = participants.length > 20 ? `\n...and ${participants.length - 20} more` : '';
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${customEmojiText('trophy')} ${tournamentGameName(active.game)} Tournament\n` +
      `${tournamentGameEmoji(active.game)} **Registration is OPEN**\n\n` +
      `**Prize**\n${escapeMassMentions(active.prize)}\n\n` +
      `**Players Joined** ${participants.length}\n${names}${more}\n\n` +
      `Registration closes <t:${Math.floor(active.registrationClosesAt / 1000)}:R>.\n` +
      `**Everyone who joins before registration closes is entered. There is no fixed player cap.**\n` +
      `${active.game === 'mixed' ? '**Game Pool:** Tic-Tac-Toe + Rock Paper Scissors. Different matches can use different games, and a draw switches that match to the other game.\n' : ''}` +
      `-# Registration is view-only. Once the bracket begins, only registered players can chat. Every match gets its own thread.`
    )
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tour:join:${active.id}`).setLabel('Join Tournament').setEmoji(customEmojiComponent('trophy')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tour:leave:${active.id}`).setLabel('Leave Tournament').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Prize Support').setStyle(ButtonStyle.Link).setURL(SUPPORT_TICKETS_URL),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function startTournamentRegistration(guild, game, prize, registrationMinutes = TOURNAMENT_REGISTRATION_MINUTES, source = 'Manual tournament') {
  if (state.tournaments?.active && ['registration', 'running'].includes(state.tournaments.active.status)) throw new Error('A tournament is already active.');
  if (state.tournaments?.active && ['finished', 'cancelled'].includes(state.tournaments.active.status)) {
    archiveTournament(state.tournaments.active);
  }
  const { channel } = await ensureTournamentInfrastructure(guild);
  await setTournamentChannelMode(guild, channel, 'registration');
  const active = {
    id: makeId(), game: game || 'mixed', prize: String(prize || 'To be announced'), status: 'registration', source,
    participants: [], round: 0, currentMatchIds: [], matches: {}, roundByeUserId: null,
    gameRotationSeed: Math.floor(Math.random() * 2),
    createdAt: Date.now(), registrationClosesAt: Date.now() + clampNumber(Number(registrationMinutes || 10), 1, 60, 10) * 60_000,
    announcementMessageId: null, transitioning: false,
  };
  state.tournaments.active = active;
  saveState();
  const msg = await channel.send(makeTournamentRegistrationPayload(active));
  active.announcementMessageId = msg.id;
  saveState();
  await ghostPingTournamentChannel(channel);
  await channel.send(v2Payload({
    title: `${customEmojiText('trophy')} Tournament Registration Open`,
    description: `Registration for the **${tournamentGameName(active.game)}** tournament is open.\n\nJoin above before registration closes. The channel stays view-only during registration. Once the bracket starts, only registered players can chat.`,
  }));
  return active;
}

async function updateTournamentRegistrationMessage(guild, active) {
  const channel = guild.channels.cache.get(state.tournaments.channelId);
  if (!channel?.isTextBased() || !active?.announcementMessageId) return;
  const msg = await channel.messages.fetch(active.announcementMessageId).catch(() => null);
  if (msg) await msg.edit(makeTournamentRegistrationPayload(active)).catch(() => {});
}

function shuffled(values) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function beginTournamentBracket(guild) {
  const active = state.tournaments?.active;
  if (!active || active.status !== 'registration' || active.transitioning) return;
  active.transitioning = true;
  saveState();
  const channel = guild.channels.cache.get(state.tournaments.channelId) || (await ensureTournamentInfrastructure(guild)).channel;
  if ((active.participants || []).length < 2) {
    active.status = 'cancelled';
    active.cancelledAt = Date.now();
    active.cancelReason = 'Not enough players';
    active.transitioning = false;
    archiveTournament(active);
    saveState();
    await setTournamentChannelMode(guild, channel, 'closed');
    await channel.send(v2Payload({ title: 'Tournament Cancelled', description: 'At least **2 players** are required. Registration closed without enough players.' }));
    return;
  }
  active.status = 'running';
  const entrants = shuffled(active.participants);
  active.transitioning = false;
  saveState();
  await setTournamentChannelMode(guild, channel, 'running', active.participants || []);
  await startTournamentRound(guild, entrants);
}

async function startTournamentRound(guild, entrants) {
  const active = state.tournaments.active;
  if (!active || active.status !== 'running') return;
  active.round = Number(active.round || 0) + 1;
  active.currentMatchIds = [];
  active.roundByeUserId = entrants.length % 2 === 1 ? entrants[entrants.length - 1] : null;
  const channel = guild.channels.cache.get(state.tournaments.channelId) || (await ensureTournamentInfrastructure(guild)).channel;
  const roundPairs = [];
  for (let i = 0; i + 1 < entrants.length; i += 2) roundPairs.push([entrants[i], entrants[i + 1]]);

  await channel.send(v2Payload({
    title: `${EMOJIS.smileyTom} Round ${active.round}`,
    description: `${roundPairs.length} match${roundPairs.length === 1 ? '' : 'es'} this round.${active.roundByeUserId ? `\n\n🎟️ <@${active.roundByeUserId}> receives an **Automatic Advance** into the next round.` : ''}\n\nEach match has its own thread. Win your match to advance.`,
  }));

  for (let i = 0; i < roundPairs.length; i++) {
    const [p1, p2] = roundPairs[i];
    const id = makeId();
    const matchGame = chooseTournamentMatchGame(active, active.round, i + 1);
    const match = {
      id, round: active.round, number: i + 1, p1, p2, winner: null, messageId: null, threadId: null, rematches: 0,
      game: matchGame, gameHistory: [matchGame], board: Array(9).fill(null), turn: p1, choices: {}, lastResult: null,
      turnDeadlineAt: matchGame === 'tictactoe' ? Date.now() + TOURNAMENT_TURN_MS : null, turnSkips: 0,
    };
    active.matches[id] = match;
    active.currentMatchIds.push(id);
    saveState();
    const msg = await channel.send(makeTournamentMatchPayload(active, match));
    match.messageId = msg.id;
    try {
      const thread = await msg.startThread({
        name: `Round ${active.round} - Match ${i + 1}`,
        autoArchiveDuration: 60,
        reason: 'PvP tournament match discussion',
      });
      match.threadId = thread.id;
      await thread.members.add(p1).catch(() => {});
      await thread.members.add(p2).catch(() => {});
      await announceMatchThreadReady(thread, match);
    } catch (error) {
      console.error(`[TOURNAMENT] Could not create thread for match ${id}:`, error);
    }
    saveState();
  }
}

function makeTournamentMatchPayload(active, match) {
  return match.game === 'rps' ? makeRpsMatchPayload(active, match) : makeTicTacToeMatchPayload(active, match);
}

async function getTournamentMatchThread(guild, match) {
  if (!match?.threadId) return null;
  return guild.channels.cache.get(match.threadId) || await guild.channels.fetch(match.threadId).catch(() => null);
}

async function announceMatchThreadReady(thread, match) {
  if (!thread?.isTextBased()) return;
  if (match.game === 'tictactoe') {
    await thread.send({
      content: `<@${match.p1}> <@${match.p2}> your match is ready. **X:** <@${match.p1}> • **O:** <@${match.p2}>\n<@${match.turn}> goes first and has **30 seconds** to move. Use the board on the match post above.`,
      allowedMentions: { users: [match.p1, match.p2] },
    }).catch(() => {});
  } else {
    await thread.send({
      content: `<@${match.p1}> <@${match.p2}> your **Rock Paper Scissors** match is ready. Both of you can lock a choice using the buttons on the match post above.`,
      allowedMentions: { users: [match.p1, match.p2] },
    }).catch(() => {});
  }
}

async function pingTournamentTurn(guild, match) {
  if (!match || match.winner) return;
  const thread = await getTournamentMatchThread(guild, match);
  if (!thread?.isTextBased()) return;
  if (match.game === 'tictactoe') {
    const symbol = match.turn === match.p1 ? 'X' : 'O';
    await thread.send({
      content: `<@${match.turn}> it is your turn. You are **${symbol}** and have **30 seconds** to move.`,
      allowedMentions: { users: [match.turn] },
    }).catch(() => {});
  } else {
    const waiting = [match.p1, match.p2].filter(id => !match.choices?.[id]);
    if (!waiting.length) return;
    await thread.send({
      content: `${waiting.map(id => `<@${id}>`).join(' ')} ${waiting.length === 1 ? 'lock your choice to continue.' : 'lock your choices to continue.'}`,
      allowedMentions: { users: waiting },
    }).catch(() => {});
  }
}

async function announceTournamentGameSwitch(guild, match, reason) {
  const thread = await getTournamentMatchThread(guild, match);
  if (!thread?.isTextBased()) return;
  const details = match.game === 'tictactoe'
    ? `**X:** <@${match.p1}> • **O:** <@${match.p2}>\n<@${match.turn}> goes first and has **30 seconds** to move.`
    : 'Both players must lock a Rock / Paper / Scissors choice.';
  await thread.send({
    content: `${reason}\n\n**Switching this match to ${tournamentGameName(match.game)}.**\n${details}\n<@${match.p1}> <@${match.p2}>`,
    allowedMentions: { users: [match.p1, match.p2] },
  }).catch(() => {});
}

async function announceTournamentMatchWinner(guild, match) {
  const thread = await getTournamentMatchThread(guild, match);
  if (!thread?.isTextBased() || !match.winner) return;
  await thread.send({
    content: `${customEmojiText('trophy')} <@${match.winner}> won this match and advances to the next round.`,
    allowedMentions: { users: [match.winner] },
  }).catch(() => {});
  setTimeout(async () => {
    await thread.setLocked(true, 'Tournament match finished').catch(() => {});
    await thread.setArchived(true, 'Tournament match finished').catch(() => {});
  }, 2500).unref?.();
}

function makeTicTacToeMatchPayload(active, match) {
  const symbol = id => id === match.p1 ? '❌' : '⭕';
  const turnTimer = match.turnDeadlineAt ? `\n**Time Limit:** 30 seconds • <t:${Math.floor(match.turnDeadlineAt / 1000)}:R>` : '';
  const status = match.winner
    ? `${customEmojiText('trophy')} **Winner:** <@${match.winner}>`
    : `${match.lastResult ? `${match.lastResult}\n` : ''}**Turn:** <@${match.turn}> ${symbol(match.turn)}${turnTimer}`;
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# ❌ ⭕ Match ${match.number} - Tic-Tac-Toe\n<@${match.p1}> **vs** <@${match.p2}>\n\n**X:** <@${match.p1}>\n**O:** <@${match.p2}>\n\n${status}\n-# Round ${match.round} • Use this match's thread for discussion. Win to advance.`
  ));
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const value = match.board?.[i];
      row.addComponents(new ButtonBuilder()
        .setCustomId(`tour:ttt:${active.id}:${match.id}:${i}`)
        .setLabel(value === match.p1 ? 'X' : value === match.p2 ? 'O' : '·')
        .setStyle(value === match.p1 ? ButtonStyle.Danger : value === match.p2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(Boolean(value || match.winner)));
    }
    rows.push(row);
  }
  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function makeRpsMatchPayload(active, match) {
  const locked1 = Boolean(match.choices?.[match.p1]);
  const locked2 = Boolean(match.choices?.[match.p2]);
  let result = `**<@${match.p1}>:** ${locked1 ? 'Choice locked' : 'Waiting'}\n**<@${match.p2}>:** ${locked2 ? 'Choice locked' : 'Waiting'}`;
  if (match.winner) {
    result = `🪨📄✂️ <@${match.p1}> chose **${rpsChoiceName(match.choices[match.p1])}**\n<@${match.p2}> chose **${rpsChoiceName(match.choices[match.p2])}**\n\n${customEmojiText('trophy')} **Winner:** <@${match.winner}>`;
  } else if (match.lastResult) result = `${match.lastResult}\n\n${result}`;
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# 🪨 📄 ✂️ Match ${match.number} - Rock Paper Scissors\n<@${match.p1}> **vs** <@${match.p2}>\n\n${result}\n-# Round ${match.round} • Choices stay hidden until both players lock in. Use this match's thread for discussion.`
  ));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tour:rps:${active.id}:${match.id}:rock`).setLabel('Rock').setEmoji('🪨').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(match.winner)),
    new ButtonBuilder().setCustomId(`tour:rps:${active.id}:${match.id}:paper`).setLabel('Paper').setEmoji('📄').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(match.winner)),
    new ButtonBuilder().setCustomId(`tour:rps:${active.id}:${match.id}:scissors`).setLabel('Scissors').setEmoji('✂️').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(match.winner)),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function ticTacToeWinner(board) {
  const combos = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of combos) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}

function rpsChoiceName(choice) {
  return ({ rock: 'Rock', paper: 'Paper', scissors: 'Scissors' })[choice] || 'Unknown';
}

function rpsWinner(p1, c1, p2, c2) {
  if (c1 === c2) return null;
  const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  return wins[c1] === c2 ? p1 : p2;
}

async function handleTournamentButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const active = state.tournaments?.active;
  if (!active || active.id !== parts[2]) return interaction.reply(v2Payload({ title: 'Tournament Ended', description: 'This tournament is no longer active.', ephemeral: true })).catch(() => {});

  if (action === 'join' || action === 'leave') {
    if (active.status !== 'registration') return interaction.reply(v2Payload({ title: 'Registration Closed', description: 'The bracket has already started.', ephemeral: true }));
    const member = interaction.member;
    if (!member?.roles?.cache?.has(CONFIG.customerRoleId)) return interaction.reply(v2Payload({ title: 'Customers Only', description: 'You need the Customer role to join this tournament.', ephemeral: true }));
    active.participants ||= [];
    const has = active.participants.includes(interaction.user.id);
    if (action === 'join') {
      if (has) return interaction.reply(v2Payload({ title: 'Already Joined', description: 'You are already registered.', ephemeral: true }));
      active.participants.push(interaction.user.id);
    } else {
      if (!has) return interaction.reply(v2Payload({ title: 'Not Registered', description: 'You are not currently in this tournament.', ephemeral: true }));
      active.participants = active.participants.filter(id => id !== interaction.user.id);
    }
    saveState();
    return interaction.update(makeTournamentRegistrationPayload(active));
  }

  const matchId = parts[3];
  const match = active.matches?.[matchId];
  if (!match || match.winner || active.status !== 'running' || match.round !== active.round) return interaction.reply(v2Payload({ title: 'Match Closed', description: 'This match is no longer accepting moves.', ephemeral: true }));
  if (![match.p1, match.p2].includes(interaction.user.id)) return interaction.reply(v2Payload({ title: 'Not Your Match', description: 'Only the two players in this match can use these controls.', ephemeral: true }));

  if (action === 'ttt') {
    if (match.game !== 'tictactoe') return interaction.reply(v2Payload({ title: 'Game Switched', description: `This match is now **${tournamentGameName(match.game)}**. Use the updated controls.`, ephemeral: true }));
    const cell = Number(parts[4]);
    if (interaction.user.id !== match.turn) return interaction.reply(v2Payload({ title: 'Wait Your Turn', description: `It is currently <@${match.turn}>'s turn.`, ephemeral: true }));
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || match.board[cell]) return interaction.reply(v2Payload({ title: 'Spot Taken', description: 'Choose an empty square.', ephemeral: true }));
    match.board[cell] = interaction.user.id;
    const winner = ticTacToeWinner(match.board);
    let switched = false;
    if (winner) {
      match.winner = winner;
      match.turnDeadlineAt = null;
    } else if (match.board.every(Boolean)) {
      match.rematches = Number(match.rematches || 0) + 1;
      match.game = otherTournamentGame(match.game);
      match.gameHistory ||= [];
      match.gameHistory.push(match.game);
      match.board = Array(9).fill(null);
      match.choices = {};
      match.turn = null;
      match.turnDeadlineAt = null;
      match.lastResult = '🤝 **Draw!** No winner from Tic-Tac-Toe.';
      switched = true;
    } else {
      match.turn = interaction.user.id === match.p1 ? match.p2 : match.p1;
      match.turnDeadlineAt = Date.now() + TOURNAMENT_TURN_MS;
      match.lastResult = null;
    }
    saveState();
    await interaction.update(makeTournamentMatchPayload(active, match));
    if (match.winner) {
      await announceTournamentMatchWinner(interaction.guild, match);
      await maybeFinishTournamentRound(interaction.guild);
    } else if (switched) {
      await announceTournamentGameSwitch(interaction.guild, match, '🤝 Tic-Tac-Toe ended in a draw.');
      await pingTournamentTurn(interaction.guild, match);
    } else {
      await pingTournamentTurn(interaction.guild, match);
    }
    return;
  }

  if (action === 'rps') {
    if (match.game !== 'rps') return interaction.reply(v2Payload({ title: 'Game Switched', description: `This match is now **${tournamentGameName(match.game)}**. Use the updated controls.`, ephemeral: true }));
    const choice = parts[4];
    if (!['rock','paper','scissors'].includes(choice)) return;
    match.choices ||= {};
    if (match.choices[interaction.user.id]) return interaction.reply(v2Payload({ title: 'Choice Already Locked', description: 'Your choice is already locked for this attempt.', ephemeral: true }));
    match.choices[interaction.user.id] = choice;
    const c1 = match.choices[match.p1], c2 = match.choices[match.p2];
    if (!c1 || !c2) {
      saveState();
      await interaction.reply(v2Payload({ title: 'Choice Locked', description: 'Your choice is hidden. Waiting for your opponent.', ephemeral: true }));
      const msg = interaction.message;
      await msg.edit(makeRpsMatchPayload(active, match)).catch(() => {});
      await pingTournamentTurn(interaction.guild, match);
      return;
    }
    const winner = rpsWinner(match.p1, c1, match.p2, c2);
    let switched = false;
    if (!winner) {
      match.rematches = Number(match.rematches || 0) + 1;
      match.lastResult = `🤝 **Tie!** Both players chose **${rpsChoiceName(c1)}**.`;
      match.game = otherTournamentGame(match.game);
      match.gameHistory ||= [];
      match.gameHistory.push(match.game);
      match.choices = {};
      match.board = Array(9).fill(null);
      match.turn = match.rematches % 2 ? match.p2 : match.p1;
      match.turnDeadlineAt = Date.now() + TOURNAMENT_TURN_MS;
      switched = true;
    } else {
      match.winner = winner;
      match.turnDeadlineAt = null;
    }
    saveState();
    await interaction.update(makeTournamentMatchPayload(active, match));
    if (match.winner) {
      await announceTournamentMatchWinner(interaction.guild, match);
      await maybeFinishTournamentRound(interaction.guild);
    } else if (switched) {
      await announceTournamentGameSwitch(interaction.guild, match, `🤝 Rock Paper Scissors tied with **${rpsChoiceName(c1)}**.`);
      await pingTournamentTurn(interaction.guild, match);
    }
  }
}

async function updateTournamentMatchMessage(guild, match) {
  const active = state.tournaments?.active;
  if (!active || !match?.messageId) return;
  const channel = guild.channels.cache.get(state.tournaments.channelId) || await guild.channels.fetch(state.tournaments.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(match.messageId).catch(() => null);
  if (message) await message.edit(makeTournamentMatchPayload(active, match)).catch(() => {});
}

async function checkTournamentTurnTimers() {
  const active = state.tournaments?.active;
  if (!active || active.status !== 'running') return;
  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (!guild) return;

  const now = Date.now();
  for (const matchId of active.currentMatchIds || []) {
    const match = active.matches?.[matchId];
    if (!match || match.winner || match.game !== 'tictactoe' || !match.turn) continue;
    // Upgrade/restart safety: older active matches may not have a persisted
    // deadline yet. Give the current player a fresh 30 seconds rather than
    // skipping them immediately or leaving the match stuck forever.
    if (!match.turnDeadlineAt) {
      match.turnDeadlineAt = Date.now() + TOURNAMENT_TURN_MS;
      saveState();
      await updateTournamentMatchMessage(guild, match);
      continue;
    }
    if (now < Number(match.turnDeadlineAt)) continue;

    const missedPlayer = match.turn;
    const nextPlayer = missedPlayer === match.p1 ? match.p2 : match.p1;
    match.turn = nextPlayer;
    match.turnSkips = Number(match.turnSkips || 0) + 1;
    match.turnDeadlineAt = Date.now() + TOURNAMENT_TURN_MS;
    match.lastResult = `⏱️ <@${missedPlayer}> did not move within 30 seconds, so their turn was skipped.`;
    saveState();

    await updateTournamentMatchMessage(guild, match);
    const thread = await getTournamentMatchThread(guild, match);
    if (thread?.isTextBased()) {
      const symbol = nextPlayer === match.p1 ? 'X' : 'O';
      await thread.send({
        content: `<@${missedPlayer}> did not move within **30 seconds**, so their turn was skipped.\n<@${nextPlayer}> it is now your turn. You are **${symbol}** and have **30 seconds** to move.`,
        allowedMentions: { users: [missedPlayer, nextPlayer] },
      }).catch(() => {});
    }
  }
}

async function maybeFinishTournamentRound(guild) {
  const active = state.tournaments?.active;
  if (!active || active.status !== 'running' || active.transitioning) return;
  const matches = (active.currentMatchIds || []).map(id => active.matches?.[id]).filter(Boolean);
  if (matches.some(m => !m.winner)) return;
  active.transitioning = true;
  saveState();
  const winners = matches.map(m => m.winner);
  if (active.roundByeUserId) winners.push(active.roundByeUserId);
  if (winners.length === 1) {
    await finishTournament(guild, winners[0]);
    return;
  }
  active.transitioning = false;
  saveState();
  await startTournamentRound(guild, winners);
}

async function sendTournamentWinnerDm(member, active) {
  if (!member?.user || !active) return false;
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${customEmojiText('trophy')} Congratulations - You Won!
` +
      `You won the **${tournamentGameName(active.game)}** tournament in **${escapeMassMentions(member.guild?.name || 'Bloxburg Store')}**.

` +
      `**Your Prize**
${escapeMassMentions(active.prize)}

` +
      `The cosmetic **Champion** role has been awarded to you.
` +
      `Use the button below to open Support and claim your prize.

` +
      `-# Great job, and congratulations on becoming the tournament champion!`
    )
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Claim Your Prize')
      .setEmoji(customEmojiComponent('trophy'))
      .setStyle(ButtonStyle.Link)
      .setURL(SUPPORT_TICKETS_URL),
  );
  try {
    await member.send({ components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error(`[TOURNAMENT] Could not DM winner ${member.id}:`, error?.message || error);
    return false;
  }
}

async function finishTournament(guild, winnerId) {
  const active = state.tournaments?.active;
  if (!active) return;
  const { channel, role } = await ensureTournamentInfrastructure(guild);
  active.status = 'finished';
  active.winnerId = winnerId;
  active.finishedAt = Date.now();
  active.transitioning = false;
  archiveTournament(active);
  saveState();
  const member = await guild.members.fetch(winnerId).catch(() => null);
  if (member && role) await member.roles.add(role, 'Won a PvP tournament').catch(() => {});
  const winnerDmDelivered = member ? await sendTournamentWinnerDm(member, active) : false;
  active.winnerDmDelivered = winnerDmDelivered;
  archiveTournament(active);
  saveState();
  await setTournamentChannelMode(guild, channel, 'celebration');
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# ${customEmojiText('trophy')} Tournament Champion\n${customEmojiText('giveaway')} <@${winnerId}> won the **${tournamentGameName(active.game)}** tournament!\n\n` +
    `**Prize**\n${escapeMassMentions(active.prize)}\n\n` +
    `${customEmojiText('trophy')} The **Champion** role has been awarded as a cosmetic winner role.\n` +
    `${customEmojiText('ticket')} Open a support ticket below to claim the prize.\n\n-# Tournament chat is now open to all Customers so everyone can congratulate the winner.`
  ));
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Claim Prize').setEmoji(customEmojiComponent('trophy')).setStyle(ButtonStyle.Link).setURL(SUPPORT_TICKETS_URL));
  await channel.send({ components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function handleTournamentSetup(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const channelName = interaction.options.getString('channel_name')?.trim();
  if (channelName) state.tournaments.channelName = channelName;
  saveState();
  const { channel, role } = await ensureTournamentInfrastructure(interaction.guild);
  await syncTournamentChannelMode(interaction.guild, channel);
  return interaction.reply(v2Payload({ title: `${customEmojiText('trophy')} Tournament System Ready`, description: `**Channel:** ${channel}\n**Customer access:** View-only during registration; registered players can chat during matches; all Customers can chat after a winner is crowned\n**Champion role:** ${role}\n**Daily schedule:** ${state.tournaments.daily.enabled ? `Enabled at ${state.tournaments.daily.time} (${CONFIG.timeZone})` : 'Disabled'}`, ephemeral: true }));
}

async function handleTournamentPrize(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const game = interaction.options.getString('game', true);
  const prize = interaction.options.getString('prize', true).trim();
  state.tournaments.prizes[game] = prize;
  saveState();
  return interaction.reply(v2Payload({ title: '💰 Tournament Prize Updated', description: `**${tournamentGameName(game)}**\n${escapeMassMentions(prize)}`, ephemeral: true }));
}

async function handleTournamentDaily(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const enabled = interaction.options.getBoolean('enabled', true);
  const time = interaction.options.getString('time');
  const game = interaction.options.getString('game');
  if (time && !parseClockTime(time)) return fail(interaction, 'Invalid Time', 'Use a 24-hour time like `19:00`.');
  state.tournaments.daily.enabled = enabled;
  if (time) state.tournaments.daily.time = time;
  if (game) state.tournaments.daily.game = game;
  state.tournaments.daily.nextAt = enabled ? nextDailyTimeTimestamp(state.tournaments.daily.time) : null;
  saveState();
  return interaction.reply(v2Payload({ title: '📅 Daily Tournament Updated', description: enabled ? `Daily tournaments are **ON**.\n\n**Time:** ${state.tournaments.daily.time} (${CONFIG.timeZone})\n**Game:** ${tournamentGameName(state.tournaments.daily.game || 'mixed')}\n**Next:** <t:${Math.floor(state.tournaments.daily.nextAt / 1000)}:F>` : 'Daily tournaments are now **OFF**.', ephemeral: true }));
}

async function handleTournamentStart(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const game = interaction.options.getString('game') || 'mixed';
  const prize = interaction.options.getString('prize')?.trim() || state.tournaments.prizes[game] || state.tournaments.prizes.mixed || 'To be announced';
  const minutes = interaction.options.getInteger('registration_minutes') || TOURNAMENT_REGISTRATION_MINUTES;
  if (state.tournaments.active && ['registration','running'].includes(state.tournaments.active.status)) return fail(interaction, 'Tournament Already Active', 'Finish or cancel the current tournament first.');
  const active = await startTournamentRegistration(interaction.guild, game, prize, minutes, 'Manual tournament');
  const channel = interaction.guild.channels.cache.get(state.tournaments.channelId);
  return interaction.reply(v2Payload({ title: `${customEmojiText('trophy')} Tournament Opened`, description: `Registration is live in ${channel}.\n\n**Game:** ${tournamentGameName(game)}\n**Prize:** ${escapeMassMentions(prize)}\n**Closes:** <t:${Math.floor(active.registrationClosesAt / 1000)}:R>`, ephemeral: true }));
}

async function handleTournamentBegin(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  if (state.tournaments?.active?.status !== 'registration') return fail(interaction, 'No Registration Open', 'There is no tournament registration to begin.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await beginTournamentBracket(interaction.guild);
  return interaction.editReply(v2Edit({ title: `${customEmojiText('trophy')} Tournament Started`, description: 'Registration is closed and the first round has been posted.' }));
}

async function handleTournamentStatus(interaction) {
  const t = state.tournaments;
  const active = t?.active;
  const channel = t?.channelId ? `<#${t.channelId}>` : 'Not created yet';
  let activeText = 'No active tournament.';
  if (active && ['registration','running'].includes(active.status)) {
    activeText = `**${tournamentGameName(active.game)}** • ${active.status}
Players: **${active.participants?.length || 0}**
Round: **${active.round || 0}**
Prize: **${escapeMassMentions(active.prize)}**`;
  }
  const latest = latestTournamentHistory();
  const latestText = latest
    ? `

**Most Recent Tournament**
${tournamentGameName(latest.game)} • **${latest.status || 'finished'}**
Players: **${latest.participants?.length || 0}**${latest.winnerId ? `
Winner: <@${latest.winnerId}>` : ''}
Prize: **${escapeMassMentions(latest.prize || 'Unknown')}**${latest.finishedAt ? `
Ended: <t:${Math.floor(latest.finishedAt / 1000)}:R>` : latest.cancelledAt ? `
Ended: <t:${Math.floor(latest.cancelledAt / 1000)}:R>` : ''}`
    : `\n\n**Most Recent Tournament**\nNo saved tournament history yet.`;
  return interaction.reply(v2Payload({ title: `${customEmojiText('trophy')} Tournament Status`, description: `**Channel:** ${channel}
**Daily:** ${t.daily.enabled ? `On at ${t.daily.time} (${CONFIG.timeZone})` : 'Off'}
**Daily Game:** ${tournamentGameName(t.daily.game || 'mixed')}

${activeText}${latestText}`, ephemeral: true }));
}

async function handleTournamentHistory(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const limit = interaction.options.getInteger('limit') || 10;
  const history = Array.isArray(state.tournaments?.history) ? state.tournaments.history.slice(-limit).reverse() : [];
  if (!history.length) return interaction.reply(v2Payload({ title: `${customEmojiText('trophy')} Tournament History`, description: 'No completed or cancelled tournaments have been saved yet.', ephemeral: true }));
  const lines = history.map((item, index) => {
    const endedAt = item.finishedAt || item.cancelledAt || item.createdAt || Date.now();
    const winner = item.winnerId ? ` • Winner <@${item.winnerId}>` : '';
    return `**${index + 1}. ${tournamentGameName(item.game)}** • ${item.status || 'finished'}${winner}
Players: **${item.participants?.length || 0}** • Rounds: **${item.round || 0}**
Prize: ${escapeMassMentions(item.prize || 'Unknown')}
<t:${Math.floor(endedAt / 1000)}:F>`;
  });
  return interaction.reply(v2Payload({ title: `${customEmojiText('trophy')} Tournament History`, description: lines.join('\n\n'), ephemeral: true }));
}

async function handleTournamentCancel(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const active = state.tournaments?.active;
  if (!active || !['registration','running'].includes(active.status)) return fail(interaction, 'No Active Tournament', 'There is no active tournament to cancel.');
  active.status = 'cancelled';
  active.cancelledAt = Date.now();
  active.cancelReason = 'Cancelled by staff';
  archiveTournament(active);
  saveState();
  const { channel } = await ensureTournamentInfrastructure(interaction.guild);
  await setTournamentChannelMode(interaction.guild, channel, 'closed');
  await channel.send(v2Payload({ title: 'Tournament Cancelled', description: 'Staff cancelled the current tournament. Tournament chat is now closed.' }));
  return interaction.reply(v2Payload({ title: 'Tournament Cancelled', description: `The tournament in ${channel} has been stopped.`, ephemeral: true }));
}

// ---------- CHAT DROPS ----------

function normalizeChatDropState(value, defaults) {
  const source = value && typeof value === 'object' ? value : {};
  return { ...defaults, ...source, activeDrop: source.activeDrop && typeof source.activeDrop === 'object' ? source.activeDrop : null };
}

function localDateKey(timestamp = Date.now()) {
  const p = zonedParts(timestamp, CONFIG.timeZone);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}

function scheduleNextChatDrop(afterTodayDrop = false) {
  const cfg = state.chatDrops;
  if (!cfg?.enabled) return null;
  const now = Date.now();
  const parts = zonedParts(now, CONFIG.timeZone);
  let targetDate = { year: parts.year, month: parts.month, day: parts.day };
  let minMinute = 8 * 60;
  const maxMinute = 23 * 60 + 45;
  const todayAlreadyUsed = afterTodayDrop || cfg.lastDropLocalDate === localDateKey(now);
  if (!todayAlreadyUsed) minMinute = Math.max(minMinute, parts.hour * 60 + parts.minute + 10);
  if (todayAlreadyUsed || minMinute > maxMinute) targetDate = addLocalDays(parts, 1), minMinute = 8 * 60;
  const minuteOfDay = Math.floor(Math.random() * (maxMinute - minMinute + 1)) + minMinute;
  cfg.nextDropAt = zonedDateTimeToUtcMs(targetDate.year, targetDate.month, targetDate.day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, CONFIG.timeZone);
  saveState();
  return cfg.nextDropAt;
}

function randomDropAmount() {
  const min = clampNumber(Number(state.chatDrops.minimum || 1), 1, CHAT_DROP_MAX, 100000);
  const max = clampNumber(Number(state.chatDrops.maximum || CHAT_DROP_MAX), min, CHAT_DROP_MAX, 900000);
  if (max - min >= 10000) {
    const low = Math.ceil(min / 10000), high = Math.floor(max / 10000);
    if (high >= low) return (Math.floor(Math.random() * (high - low + 1)) + low) * 10000;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeChatDropPayload(drop) {
  const claimed = Boolean(drop.claimedBy);
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
    claimed
      ? `# 💰 Cash Drop Claimed\n${customEmojiText('trophy')} <@${drop.claimedBy}> was the first person to claim **$${Number(drop.amount).toLocaleString()} Bloxburg Cash**!\n\n${customEmojiText('ticket')} Use the support button below to claim the prize.`
      : `# 💸 CHAT DROP\n**$${Number(drop.amount).toLocaleString()} Bloxburg Cash** is up for grabs!\n\n⚡ **First person to click wins.**\n-# One claim only. Be quick.`
  ));
  const row = new ActionRowBuilder();
  if (!claimed) row.addComponents(new ButtonBuilder().setCustomId(`chatdrop:claim:${drop.id}`).setLabel('Claim Drop').setEmoji('💰').setStyle(ButtonStyle.Success));
  else row.addComponents(new ButtonBuilder().setLabel('Claim Prize').setEmoji(customEmojiComponent('ticket')).setStyle(ButtonStyle.Link).setURL(SUPPORT_TICKETS_URL));
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function sendChatDrop(guild, channel, amount = null, scheduled = false) {
  if (state.chatDrops.activeDrop && !state.chatDrops.activeDrop.claimedBy) throw new Error('There is already an unclaimed chat drop.');
  const drop = { id: makeId(), amount: amount || randomDropAmount(), channelId: channel.id, messageId: null, claimedBy: null, createdAt: Date.now(), scheduled };
  state.chatDrops.activeDrop = drop;
  state.chatDrops.lastDropLocalDate = localDateKey();
  saveState();
  const msg = await channel.send(makeChatDropPayload(drop));
  drop.messageId = msg.id;
  if (state.chatDrops.enabled) scheduleNextChatDrop(true); else saveState();
  return drop;
}

async function checkChatDrops() {
  const cfg = state.chatDrops;
  if (!cfg?.enabled) return;
  if (!cfg.nextDropAt) scheduleNextChatDrop(false);
  if (!cfg.nextDropAt || Date.now() < cfg.nextDropAt) return;
  const guild = client.guilds.cache.get(CONFIG.guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel?.isTextBased()) {
    cfg.enabled = false;
    cfg.nextDropAt = null;
    saveState();
    return;
  }
  if (cfg.activeDrop && !cfg.activeDrop.claimedBy) {
    scheduleNextChatDrop(true);
    return;
  }
  try { await sendChatDrop(guild, channel, null, true); }
  catch (error) { console.error('[CHAT DROP] Scheduled send failed:', error); scheduleNextChatDrop(true); }
}

async function handleChatDropButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (action !== 'claim') return;
  const drop = state.chatDrops?.activeDrop;
  if (!drop || drop.id !== id) return interaction.reply(v2Payload({ title: 'Drop Expired', description: 'This cash drop is no longer active.', ephemeral: true }));
  if (drop.claimedBy) return interaction.reply(v2Payload({ title: 'Too Slow', description: `<@${drop.claimedBy}> already claimed this drop.`, ephemeral: true }));
  drop.claimedBy = interaction.user.id;
  drop.claimedAt = Date.now();
  saveState();
  await interaction.update(makeChatDropPayload(drop));
  await logAction({ title: 'Chat Drop Claimed', description: `${interaction.user} claimed a Bloxburg cash drop.`, moderator: client.user, target: interaction.user, reason: `$${Number(drop.amount).toLocaleString()} Bloxburg Cash`, extra: `Channel: <#${drop.channelId}>` }).catch(() => {});
}

async function handleChatDrops(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const sub = interaction.options.getSubcommand();
  const cfg = state.chatDrops;
  if (sub === 'start') {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased()) return fail(interaction, 'Invalid Channel', 'Choose a normal text channel for chat drops.');
    const minimum = interaction.options.getInteger('minimum') ?? cfg.minimum ?? 100000;
    const maximum = interaction.options.getInteger('maximum') ?? cfg.maximum ?? 900000;
    if (minimum > maximum) return fail(interaction, 'Invalid Range', 'The minimum cannot be higher than the maximum.');
    cfg.enabled = true; cfg.channelId = channel.id; cfg.minimum = minimum; cfg.maximum = Math.min(maximum, CHAT_DROP_MAX); cfg.nextDropAt = null;
    scheduleNextChatDrop(false);
    return interaction.reply(v2Payload({ title: '💸 Daily Chat Drops Enabled', description: `**Channel:** ${channel}\n**Range:** $${minimum.toLocaleString()} - $${cfg.maximum.toLocaleString()}\n**Next random drop:** <t:${Math.floor(cfg.nextDropAt / 1000)}:R>\n\n-# The bot will not run this system unless /chatdrops start has been used.`, ephemeral: true }));
  }
  if (sub === 'stop') {
    cfg.enabled = false; cfg.nextDropAt = null; saveState();
    return interaction.reply(v2Payload({ title: 'Chat Drops Disabled', description: 'Automatic daily cash drops are now OFF. Any already-posted drop stays claimable.', ephemeral: true }));
  }
  if (sub === 'status') {
    return interaction.reply(v2Payload({ title: '💰 Chat Drop Status', description: `**Automatic drops:** ${cfg.enabled ? 'ON' : 'OFF'}\n**Channel:** ${cfg.channelId ? `<#${cfg.channelId}>` : 'Not set'}\n**Range:** $${Number(cfg.minimum).toLocaleString()} - $${Number(cfg.maximum).toLocaleString()}\n**Next:** ${cfg.enabled && cfg.nextDropAt ? `<t:${Math.floor(cfg.nextDropAt / 1000)}:F> (<t:${Math.floor(cfg.nextDropAt / 1000)}:R>)` : 'Not scheduled'}\n**Active unclaimed drop:** ${cfg.activeDrop && !cfg.activeDrop.claimedBy ? `$${Number(cfg.activeDrop.amount).toLocaleString()}` : 'None'}`, ephemeral: true }));
  }
  if (sub === 'now') {
    const channel = interaction.options.getChannel('channel') || (cfg.channelId ? interaction.guild.channels.cache.get(cfg.channelId) : null) || interaction.channel;
    if (!channel?.isTextBased()) return fail(interaction, 'Invalid Channel', 'Choose a normal text channel.');
    const amount = interaction.options.getInteger('amount') || randomDropAmount();
    if (cfg.activeDrop && !cfg.activeDrop.claimedBy) return fail(interaction, 'Drop Already Active', 'The previous chat drop still has not been claimed.');
    await sendChatDrop(interaction.guild, channel, amount, false);
    return interaction.reply(v2Payload({ title: '💸 Chat Drop Sent', description: `A **$${Number(amount).toLocaleString()}** cash drop was posted in ${channel}.`, ephemeral: true }));
  }
}

// ---------- FAQ ----------

function normalizeFaqState(value, defaults) {
  const source = value && typeof value === 'object' ? value : {};
  return { ...defaults, ...source, items: Array.isArray(source.items) ? source.items : [] };
}

async function ensureFaqChannel(guild) {
  state.faq ||= { channelId: null, messageId: null, items: [] };

  const customerRole = guild.roles.cache.get(CONFIG.customerRoleId) || await guild.roles.fetch(CONFIG.customerRoleId).catch(() => null);
  if (!customerRole) throw new Error(`Customer role ${CONFIG.customerRoleId} could not be found.`);

  const botMember = guild.members.me || await guild.members.fetchMe();

  let channel = state.faq.channelId ? guild.channels.cache.get(state.faq.channelId) : null;
  channel ||= guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === FAQ_CHANNEL_NAME) || null;

  const readOnlyDeny = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.AddReactions,
  ];

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel, ...readOnlyDeny],
    },
    {
      id: customerRole.id,
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: readOnlyDeny,
    },
    {
      id: botMember.id,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (!channel) {
    channel = await guild.channels.create({
      name: FAQ_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: 'Frequently asked questions and a direct link to Bloxburg Store support tickets.',
      permissionOverwrites: overwrites,
      reason: 'Auto-created Customer-only FAQ channel',
    });
  } else {
    // Replace the overwrite set instead of layering more permissions on top.
    // This removes old role-specific ViewChannel grants that could expose the FAQ
    // to non-Customer roles after a restart or category permission change.
    await channel.permissionOverwrites.set(overwrites, 'Enforce Customer-only read-only FAQ permissions');
    if (channel.topic !== 'Frequently asked questions and a direct link to Bloxburg Store support tickets.') {
      await channel.setTopic('Frequently asked questions and a direct link to Bloxburg Store support tickets.', 'Keep FAQ channel topic in sync').catch(() => {});
    }
  }

  state.faq.channelId = channel.id;
  saveState();
  return channel;
}

function makeFaqPayload() {
  const items = state.faq?.items || [];
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ❓ Bloxburg Store FAQ\nFind quick answers below. If you still need help, use the **Make a Support Ticket** button at the bottom.`)
  );
  if (!items.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No FAQ entries have been added yet.*'));
  } else {
    for (const [i, item] of items.entries()) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${i + 1}. ${escapeMassMentions(item.question)}\n${escapeMassMentions(item.answer)}`));
    }
  }
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Make a Support Ticket').setEmoji(customEmojiComponent('ticket')).setStyle(ButtonStyle.Link).setURL(SUPPORT_TICKETS_URL));
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function isFaqPanelMessage(message) {
  if (!message || message.author?.id !== client.user?.id) return false;
  try {
    const serialized = JSON.stringify(message.components?.map(component => component.toJSON?.() ?? component) || []);
    return serialized.includes('Bloxburg Store FAQ') || serialized.includes(SUPPORT_TICKETS_URL);
  } catch {
    return false;
  }
}

async function findFaqPanelMessages(channel) {
  const found = [];
  let before;

  // The FAQ channel should contain only the bot panel, but scan a few pages so
  // older duplicates from previous deployments are also cleaned up.
  for (let page = 0; page < 3; page += 1) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    for (const message of batch.values()) {
      if (isFaqPanelMessage(message)) found.push(message);
    }
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return found.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function refreshFaqMessage(guild) {
  const channel = await ensureFaqChannel(guild);
  const candidates = await findFaqPanelMessages(channel);

  let msg = state.faq.messageId ? await channel.messages.fetch(state.faq.messageId).catch(() => null) : null;
  if (!isFaqPanelMessage(msg)) msg = null;

  // If state.json was reset on a deploy, recover the existing panel instead of
  // blindly sending a new one. Prefer the oldest surviving panel so its position
  // in the channel stays stable.
  if (!msg && candidates.length) msg = candidates[0];

  if (!msg) {
    msg = await channel.send(makeFaqPayload());
  } else {
    await msg.edit(makeFaqPayload());
  }

  // Remove any duplicate FAQ panels left by older restarts/deployments.
  const duplicates = candidates.filter(candidate => candidate.id !== msg.id);
  if (duplicates.length) {
    await Promise.allSettled(duplicates.map(candidate => candidate.delete()));
    console.log(`[FAQ] Removed ${duplicates.length} duplicate FAQ panel(s) from #${channel.name}.`);
  }

  state.faq.messageId = msg.id;
  saveState();
  return { channel, msg };
}

async function handleEmojiCheck(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;

  await resolveConfiguredCustomEmojis();
  const lines = [];
  for (const [key, spec] of Object.entries(CUSTOM_EMOJI_SPECS)) {
    const emoji = resolvedCustomEmojis.get(key);
    if (emoji) {
      lines.push(`**${key}** - ${customEmojiText(key)} found as \`${emoji.name}\` (ID \`${emoji.id}\`) in **${escapeMassMentions(emoji.guild?.name || 'connected server')}**`);
    } else {
      lines.push(`**${key}** - NOT FOUND (ID \`${spec.id}\`). The bot cannot render this custom emoji until it can access the server that owns it.`);
    }
  }

  return interaction.reply(v2Payload({
    title: 'Custom Emoji Check',
    description: `${lines.join('\n')}\n\nThe FAQ/tournament/drop panels now use the fetched Discord emoji object directly for button emojis.`,
    ephemeral: true,
  }));
}

async function handleFaqAdd(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  if ((state.faq.items || []).length >= 9) return fail(interaction, 'FAQ Full', 'The live V2 FAQ panel supports up to 9 entries. Remove or combine an older entry before adding another.');
  const question = interaction.options.getString('question', true).trim();
  const answer = interaction.options.getString('answer', true).trim();
  state.faq.items.push({ id: makeId(), question, answer, createdAt: Date.now() });
  saveState();
  const { channel } = await refreshFaqMessage(interaction.guild);
  return interaction.reply(v2Payload({ title: 'FAQ Added', description: `Added **#${state.faq.items.length}** and refreshed ${channel}.`, ephemeral: true }));
}

async function handleFaqEdit(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const number = interaction.options.getInteger('number', true);
  const item = state.faq.items?.[number - 1];
  if (!item) return fail(interaction, 'FAQ Not Found', `There is no FAQ entry #${number}.`);
  const question = interaction.options.getString('question');
  const answer = interaction.options.getString('answer');
  if (!question && !answer) return fail(interaction, 'Nothing To Change', 'Provide a new question, answer, or both.');
  if (question) item.question = question.trim();
  if (answer) item.answer = answer.trim();
  item.updatedAt = Date.now();
  saveState();
  const { channel } = await refreshFaqMessage(interaction.guild);
  return interaction.reply(v2Payload({ title: 'FAQ Updated', description: `Updated **FAQ #${number}** and refreshed ${channel}.`, ephemeral: true }));
}

async function handleFaqRemove(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const number = interaction.options.getInteger('number', true);
  const item = state.faq.items?.[number - 1];
  if (!item) return fail(interaction, 'FAQ Not Found', `There is no FAQ entry #${number}.`);
  state.faq.items.splice(number - 1, 1);
  saveState();
  const { channel } = await refreshFaqMessage(interaction.guild);
  return interaction.reply(v2Payload({ title: 'FAQ Removed', description: `Removed **${escapeMassMentions(item.question)}** and refreshed ${channel}.`, ephemeral: true }));
}

async function handleFaqList(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const items = state.faq.items || [];
  const text = items.length ? items.map((x, i) => `**${i + 1}.** ${escapeMassMentions(x.question)}`).join('\n') : 'No FAQ entries have been added yet.';
  return interaction.reply(v2Payload({ title: 'Saved FAQ Entries', description: truncate(text, 3500), ephemeral: true }));
}

async function handleFaqRefresh(interaction) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
  const { channel } = await refreshFaqMessage(interaction.guild);
  return interaction.reply(v2Payload({ title: 'FAQ Refreshed', description: `The live FAQ message in ${channel} has been rebuilt.`, ephemeral: true }));
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
    version: 8,
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
    dmPolls: {},
    pollResultsChannelId: null,
    tournaments: {
      channelId: null,
      championRoleId: null,
      channelName: TOURNAMENT_CHANNEL_NAME,
      prizes: { mixed: 'To be announced', tictactoe: 'To be announced', rps: 'To be announced' },
      daily: { enabled: true, time: '19:00', game: 'mixed', nextAt: null, rotationIndex: 0 },
      history: [],
      chatParticipantIds: [],
      active: null,
    },
    chatDrops: {
      enabled: false,
      channelId: null,
      minimum: 100000,
      maximum: 900000,
      nextDropAt: null,
      activeDrop: null,
      lastDropLocalDate: null,
    },
    faq: { channelId: null, messageId: null, items: [] },
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
      dmPolls: parsed.dmPolls && typeof parsed.dmPolls === 'object' ? parsed.dmPolls : {},
      pollResultsChannelId: parsed.pollResultsChannelId || null,
      tournaments: normalizeTournamentState(parsed.tournaments, defaults.tournaments),
      chatDrops: normalizeChatDropState(parsed.chatDrops, defaults.chatDrops),
      faq: normalizeFaqState(parsed.faq, defaults.faq),
      lockdown: parsed.lockdown || defaults.lockdown,
    };
  } catch (error) {
    console.error('[STATE] Failed to read state.json:', error);
    const backupFile = `${STATE_FILE}.bak`;
    if (fs.existsSync(backupFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        console.warn('[STATE] Recovered state from state.json.bak.');
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
            ? { trackingSince: parsed.memberActivity.trackingSince || Date.now(), events: Array.isArray(parsed.memberActivity.events) ? parsed.memberActivity.events : [] }
            : defaults.memberActivity,
          censorWarnCooldowns: parsed.censorWarnCooldowns && typeof parsed.censorWarnCooldowns === 'object' ? parsed.censorWarnCooldowns : {},
          dmPolls: parsed.dmPolls && typeof parsed.dmPolls === 'object' ? parsed.dmPolls : {},
          pollResultsChannelId: parsed.pollResultsChannelId || null,
          tournaments: normalizeTournamentState(parsed.tournaments, defaults.tournaments),
          chatDrops: normalizeChatDropState(parsed.chatDrops, defaults.chatDrops),
          faq: normalizeFaqState(parsed.faq, defaults.faq),
          lockdown: parsed.lockdown || defaults.lockdown,
        };
      } catch (backupError) {
        console.error('[STATE] Backup recovery also failed:', backupError);
      }
    }
    console.error('[STATE] No usable state backup; using fresh state.');
    return defaults;
  }
}

function saveState() {
  const temp = `${STATE_FILE}.tmp`;
  const backup = `${STATE_FILE}.bak`;
  try {
    if (fs.existsSync(STATE_FILE)) fs.copyFileSync(STATE_FILE, backup);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, STATE_FILE);
  } catch (error) {
    console.error('[STATE] Failed to save state:', error);
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
  }
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
