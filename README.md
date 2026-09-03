# Bloxy Moderation Bot

Standalone Discord.js moderation/security bot for the configured Bloxy server.

## Main systems

- Components V2 responses and moderation logs.
- `/lockdown` hides the configured category from the Customer role.
- `/unlockdown` restores the exact Customer-role permission overwrites saved before lockdown.
- New channels created in the category while lockdown is active are automatically hidden too.
- General chat is cleared every 3 days while pinned messages are preserved.
- `/baptize` manually runs the same full clear.
- After every baptism the bot sends plain text exactly:
  `Chat has been baptized once again <:ThumbsupTom:1537715616369217567>`
- Persistent warning history, including automatic censor warnings with a 60-second per-user warning cooldown.
- Persistent temporary bans with automatic expiry after bot restarts.
- Server-wide custom censor list.
- Discord links are automatically deleted from every channel/thread in category `1537689865267974192`.
- Suspicious new-account / possible-alt risk checks with admin alerts and logging.
- Moderation log channel: `1537728472997306389`.
- Incoming DM log channel: `1541705487052046408`. Incoming text, images/videos, files, and stickers are logged.

## Moderation commands

### Emergency / channels
- `/lockdown [reason]`
- `/unlockdown [reason]`
- `/baptize [reason]`
- `/purge amount [member] [reason]`
- `/slowmode seconds [reason]`
- `/lockchannel [reason]`
- `/unlockchannel [reason]`
- `/nick member [nickname] [reason]`

### Warnings / timeouts
- `/warn member reason`
- `/warnings member`
- `/clearwarnings member [reason]`
- `/timeout member duration reason`
- `/untimeout member [reason]`

### Kicks / bans
- `/kick member reason`
- `/ban user reason [delete_days]`
- `/unban user_id [reason]`
- `/tempban user duration reason [delete_days]` - examples: `1h`, `3d`, `2w`; automatically expires, max 365 days.
- `/softban user reason [delete_days]` - bans then immediately unbans, primarily to remove recent messages.
- `/baninfo user_id`
- `/banlist`

### DM logging
- Any non-bot user who directly messages the bot is logged to `1541705487052046408`.
- Text is recorded with the sender username and user ID.
- Images/videos are displayed directly inside the Components V2 log using a media gallery.
- Other file attachments are preserved as clickable CDN links with file sizes.
- Sticker-only and attachment-only DMs are logged even when there is no message text.
- Set `DM_LOG_CHANNEL_ID` in `.env` to change the destination.

### Server info / analytics
- `/roleinfo role` - role mention, **copyable role ID code**, member count, position, color, creation time and permissions.
- `/memberinfo [member]` - username/display name, user ID, account creation, server join time, roles and timeout state. Staff with Moderate Members also see saved warning count.
- `/serverinfo` - server ID, owner, creation time, members, channels, roles, emojis, stickers and boosts.
- `/serverstats` - current humans/bots plus joins, leaves and net growth for 24 hours, 7 days and 30 days.
- `/servergraph [range]` - actual PNG bar graph for 7, 14 or 30 days of recorded joins vs leaves.
- `/channelinfo [channel]` - channel ID, type, parent/category, creation time, slowmode, NSFW state and topic.
- `/avatar [member]` - full-size avatar in a V2 media gallery.
- `/servericon` - full-size server icon.
- `/permissions [member]` - effective server permissions.
- `/rolelist` - server roles with IDs.
- `/ping` - gateway latency and uptime.
- `/botinfo` - bot ID, version, uptime, command count and configured server.

Join/leave analytics begin when v1.8 first starts; Discord does not provide historical leave events retroactively. Activity is stored in `data/state.json`. On Railway, mount persistent storage to the bot's `data` directory if you want graphs/warnings/state to survive redeployments.

### Staff DMs
- `/talk message [user] [channel]` - sends plain text through the bot. If `user` is selected it DMs that user; otherwise it sends to `channel`, or defaults to the channel where the command was run. Requires Moderate Members.
- `/dmall message [role]` - sends the exact plain-text message to every non-bot member, or only non-bot members with the selected role. Reports delivered/failed counts and logs the broadcast. Administrator-only.

Members with closed DMs are counted as failed deliveries rather than stopping the broadcast. The bot uses a small worker pool instead of launching every DM request at once.

### Censor
- `/censoradd word [reason]` - adds a word or phrase to the server-wide censor.
- `/censorremove word [reason]`
- `/censorlist`

Censor matching is case-insensitive and normalizes common leetspeak. Longer single words also catch simple punctuation/spacing bypasses such as `w.o.r.d`. Every censor hit deletes the message and automatically adds a warning, with a 60-second per-user warning cooldown to prevent instant warning spam.

The censor applies to every non-bot member, including staff/admins. Staff with `Administrator` or `Manage Messages` only bypass the category Discord-link filter.

### Alt-risk checks
- `/altcheck member`

The automatic check runs whenever a non-bot account joins. Signals currently include:
- account age;
- default/no custom avatar;
- same avatar hash as a recently banned user;
- username/global/display-name similarity to recently banned users;
- bursts of multiple new accounts joining close together.

Scores at or above `ALT_ALERT_THRESHOLD` ping admins in the mod-log channel. Scores of 25+ are logged without a ping so staff still has a record.

**Important:** this is a heuristic risk system, not proof that somebody is an alt. Discord bots do not receive member IP addresses or device identity.

If `ADMIN_ALERT_ROLE_ID` is configured, alt alerts ping that role. If it is blank, the bot discovers non-bot members with `Administrator` permission and pings them directly.

## Discord-link filter

Inside category `1537689865267974192`, non-staff messages containing Discord URLs such as `discord.gg/...`, `discord.com/...`, or `discordapp.com/...` are deleted. This also covers threads whose parent channel is inside that category. The user is notified by DM and the deletion is logged.

## Setup

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env`.
3. Add the bot token to `BOT_TOKEN`.
4. Optionally add the admin role ID to `ADMIN_ALERT_ROLE_ID`.
5. In **Discord Developer Portal > Bot > Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**

Direct-message logging also uses the bot's `DirectMessages` gateway intent internally; no extra privileged-intent toggle is required for that intent.
6. Install and start:

```bash
npm install
npm start
```

Slash commands are registered to the configured guild when the bot starts.

## Required bot permissions

Give the bot the following where appropriate:
- View Channels
- Send Messages
- Read Message History
- Manage Messages
- Manage Channels
- Moderate Members
- Kick Members
- Ban Members
- Manage Nicknames

For lockdowns, ensure the bot can edit the Customer role permission overwrites. For moderation actions, its highest role must be above the target member's highest role.

## Persistence

`data/state.json` is created automatically and stores warnings, censor-warning cooldowns, censored terms, temporary bans, recent alt-risk data, join/leave analytics, category lockdown snapshots, channel lock snapshots, and the next scheduled baptism. Keep this file on persistent storage when hosting the bot so restarts/redeployments do not lose state. For Railway, mount a Volume to the service `data` directory.

## Moderation DMs

Punitive moderation commands attempt to DM the affected user a clean Components V2 **Moderation Notice** with no accent stripe. The notice includes the action, reason, and duration/expiry when relevant. The moderator is intentionally not shown to the affected user. Ban, temporary-ban, kick, and softban notices are attempted **before** removing the user from the server. Timeout, warning, and timeout-removal notices are also supported.

All bot V2 containers intentionally have **no accent color**, so Discord does not show a colored strip on the left side.


## Censor behavior

`/censoradd` accepts multiple words at once. Each space/comma-separated censor entry becomes its own trigger word. If any trigger appears in a non-bot message anywhere in the server, the whole message is deleted. Existing older multi-word censor entries are automatically split into individual trigger words when state is loaded.
