# Bloxy Moderation Bot

Standalone Discord.js moderation/security bot for the configured Bloxy server.

## Main systems

- Components V2 responses and moderation logs.
- Rotating Discord presence/status messages with no emojis.
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
- Discord links are automatically deleted from every channel/thread in category `1537689865267974192` for normal users. A zero-permission `Link Bypass` role is auto-created; staff/moderators are auto-given it and anyone manually given that role also bypasses the link filter.
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

Join/leave analytics begin when v1.8+ first starts; Discord does not provide historical leave events retroactively. Activity is stored in `data/state.json`. On Railway, mount persistent storage to the bot's `data` directory if you want graphs/warnings/state to survive redeployments.

### Staff DMs
- `/talk message [user] [channel]` - sends plain text through the bot. If `user` is selected it DMs that user; otherwise it sends to `channel`, or defaults to the channel where the command was run. Requires Moderate Members.
- `/dmall message [role]` - sends the exact plain-text message to every non-bot member, or only non-bot members with the selected role. Reports delivered/failed counts and logs the broadcast. Administrator-only.

Members with closed DMs are counted as failed deliveries rather than stopping the broadcast. The bot uses a small worker pool instead of launching every DM request at once.


## PvP tournaments

The bot automatically creates a customer-only `#pvp-tournaments` channel and a cosmetic `Champion` role with no permissions. `@everyone` cannot see the tournament channel; the configured Customer role can view it. Registration is view-only. Once the bracket starts, only registered participants can chat in the main tournament channel. Every match gets its own thread; after a champion is crowned, the main channel opens to all Customers so they can congratulate the winner.

Games included in v2.8:
- **Tic-Tac-Toe** - real 3x3 Discord button board, turn enforcement, automatic draw rematches and round advancement.
- **Rock Paper Scissors** - private hidden choices until both players lock in, tie rematches and automatic round advancement.

Tournament commands:
- `/tournamentsetup [channel_name]` - create/repair the channel and Champion role.
- `/tournamentprize game prize` - save the normal prize text for each game.
- `/tournamentdaily enabled [time] [game]` - enable/disable the daily tournament and choose `HH:MM` plus a game pool. Default is **19:00 Pacific/Auckland** with **Mixed PvP Games**.
- `/tournamentstart [game] [prize] [registration_minutes]` - manually open registration now. The game defaults to **Mixed PvP Games**.
- `/tournamentbegin` - close registration and start the bracket immediately.
- `/tournamentstatus` - show configuration/current round.
- `/tournamentcancel` - stop the active tournament and lock chat.

Daily/manual tournaments use a timed registration stage with **no fixed player cap**. However many eligible customers join before registration closes become the bracket; odd-sized rounds use an **Automatic Advance** until one player remains. Mixed tournaments split matches between Tic-Tac-Toe and Rock Paper Scissors, and a draw/tie switches that match to the other game. The winner receives the cosmetic **Champion** role and a V2 winner panel with a **Claim Prize** button linking to the support-ticket channel.

## Random chat drops

Chat drops are **disabled by default** and do not start until an administrator runs `/chatdrops start`. Once enabled, the bot schedules one cash drop at a random local time each day. Every generated amount is below **1,000,000 Bloxburg Cash**, and the first member to click the claim button wins.

Commands:
- `/chatdrops start [channel] [minimum] [maximum]` - enable the daily random drop system.
- `/chatdrops stop` - stop future automatic drops.
- `/chatdrops status` - show the configured range and exact next scheduled time privately to staff.
- `/chatdrops now [channel] [amount]` - send a drop immediately.

The winning panel links to the same support-ticket channel for prize fulfilment.

## FAQ channel

The bot automatically creates a read-only `#faq` channel and maintains one live Components V2 FAQ panel with a **Make a Support Ticket** link button to `1537689865267974190`.

Commands:
- `/faqadd question answer`
- `/faqedit number [question] [answer]`
- `/faqremove number`
- `/faqlist`
- `/faqrefresh`

The V2 FAQ panel supports up to 9 saved entries so every answer remains within Discord Components V2 limits.

### Interactive DM polls
The bot can create multi-question surveys and DM them to the whole server or only one role. Members receive one clean Components V2 poll DM with a **Start Poll** button, then move through the questions interactively.

Commands:
- `/dmpollcreate name title [description]` - creates a draft poll and gives it a short poll ID.
- `/dmquestion poll question type [options] [required]` - adds a question. Supported types are pick-one, pick-multiple, written answer, Yes/No, and 1-5 rating.
- `/dmquestionremove poll number` - removes a draft question.
- `/dmpollview poll` - previews the question set and current response counts.
- `/dmpolllist` - lists saved polls, IDs, status, question count and submissions.
- `/dmallpoll poll [role]` - sends the poll to every non-bot member by default, or only members with the selected role. Re-running it skips members who already received that poll and can pick up new matching members.
- `/dmpollresults poll` - posts a fresh aggregate summary into the private poll-results channel.
- `/dmpollexport poll` - posts a CSV containing every submitted answer into the private poll-results channel.
- `/dmpollclose poll` - stops future submissions from existing DM buttons.
- `/setpollchannel channel` - chooses an existing private text channel for poll data.

Question behavior:
- Pick-one / Yes-No / 1-5 questions use a select menu.
- Pick-multiple questions let the member choose several options.
- Written questions open a Discord modal so the member can type a longer answer.
- Optional questions can be skipped.
- A final **Submit Poll** button commits the response.

Poll data is private by default. If `POLL_RESULTS_CHANNEL_ID` is blank and `/setpollchannel` has not been used, the bot automatically creates `#dm-poll-results` with `@everyone` denied View Channel. Each completed response is posted there, a live aggregate summary is updated, and `/dmpollexport` can produce a full CSV. `/setpollchannel` refuses to use a channel that is visible to `@everyone`.

The poll definitions, delivery records, answers, submissions and selected results channel are stored in `data/state.json`, so use persistent Railway storage for this feature too.

### Status rotator
The bot rotates its Discord activity every 20 seconds. The included messages are:
- `Watching over Bloxburg Store`
- `Playing Keeping chat clean`
- `Watching for suspicious accounts`
- `Playing Protecting the community`
- `Watching <member count> members`
- `Playing Keeping things under control`
- `Watching server activity`

No emojis are used in the rotating statuses.

### Censor
- `/censoradd word [reason]` - adds a word or phrase to the server-wide censor.
- `/censorremove word [reason]`
- `/censorlist`

Censor matching is case-insensitive and normalizes common leetspeak. Longer single words also catch simple punctuation/spacing bypasses such as `w.o.r.d`. Every censor hit deletes the message and automatically adds a warning, with a 60-second per-user warning cooldown to prevent instant warning spam.

The censor applies to every non-bot member, including staff/admins. The category Discord-link filter is bypassed by the auto-created **Link Bypass** role and by moderation-level permissions (`Administrator`, `Manage Guild`, `Manage Messages`, `Moderate Members`, `Kick Members`, or `Ban Members`). On startup and member-role updates, the bot automatically gives **Link Bypass** to recognised Admin/Moderator/Staff roles. The role has **no Discord permissions** of its own and can also be assigned manually to any trusted member. The censor still applies to staff/admins.

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
- Manage Roles (to create/award the cosmetic Champion role)

For lockdowns, ensure the bot can edit the Customer role permission overwrites. For moderation actions, its highest role must be above the target member's highest role.

## Persistence

`data/state.json` is created automatically and stores warnings, censor-warning cooldowns, censored terms, temporary bans, recent alt-risk data, join/leave analytics, category lockdown snapshots, channel lock snapshots, and the next scheduled baptism. Keep this file on persistent storage when hosting the bot so restarts/redeployments do not lose state. For Railway, mount a Volume to the service `data` directory.

## Moderation DMs

Punitive moderation commands attempt to DM the affected user a clean Components V2 **Moderation Notice** with no accent stripe. The notice includes the action, reason, and duration/expiry when relevant. The moderator is intentionally not shown to the affected user. Ban, temporary-ban, kick, and softban notices are attempted **before** removing the user from the server. Timeout, warning, and timeout-removal notices are also supported.

All bot V2 containers intentionally have **no accent color**, so Discord does not show a colored strip on the left side.


## Censor behavior

`/censoradd` accepts multiple words at once. Each space/comma-separated censor entry becomes its own trigger word. If any trigger appears in a non-bot message anywhere in the server, the whole message is deleted. Existing older multi-word censor entries are automatically split into individual trigger words when state is loaded.

## v2.5 changes

- Keeps every v2.2 tournament, chat-drop, FAQ, moderation, analytics and poll feature.
- Tournament panels and winners now use `<a:Trophy_fixed:1545550040628461588>` as the trophy emoji.
- Removes the old 32-player tournament cap completely. Every eligible customer who joins during the registration window is entered into the bracket.
- Odd player counts continue to use automatic byes so brackets work with any signup count of 2 or more.


## Customer-only FAQ hardening (v2.5)
- `#faq` is visible to the configured Customer role only (Administrators still bypass Discord channel denies).
- Customers can read history but cannot send messages, react, create threads, or send in threads.
- Existing role-specific FAQ overwrites are replaced so old View Channel grants do not leak access.
- The bot discovers and edits the existing FAQ V2 panel after restarts, and automatically deletes duplicate FAQ panels instead of reposting them.

## v2.5 tournament reliability

- Uses `<a:Trophy_fixed:1545550040628461588>` throughout tournament V2 displays and as a real custom button emoji.
- Ghost-pings `@everyone` in the customer-only tournament channel when registration opens, then deletes the ping message.
- Winners receive a Components V2 DM with the prize and a direct Support claim button.
- Completed/cancelled tournaments are retained in persistent history (`/tournamenthistory`) instead of being overwritten by the next event.
- State storage automatically uses a Railway Volume mount when available (or `/data`) and keeps `state.json.bak` as a recovery copy. For Railway, mount a Volume at `/data` so data survives deployments.

## v2.7 tournament match threads

- Mixed PvP Games are now the default tournament format, so one tournament can contain both Tic-Tac-Toe and Rock Paper Scissors matches.
- Each match post automatically creates its own thread underneath the match message.
- The two matched players are pinged in their thread when the match begins.
- Tic-Tac-Toe match cards explicitly show which player is **X** and which player is **O**.
- The current Tic-Tac-Toe player is pinged in the match thread after every move.
- In Rock Paper Scissors, the remaining player is pinged after their opponent locks a choice.
- A Tic-Tac-Toe draw switches the match to Rock Paper Scissors; an RPS tie switches it to Tic-Tac-Toe.
- During the bracket, only registered tournament players can send messages in the main tournament channel.
- Match-thread messages from anyone other than that match's two players are automatically removed (staff/admin moderation access is preserved).
- Finished match threads are locked and archived automatically.
- After the tournament winner is crowned, the main tournament channel opens to all Customers so they can congratulate the champion.



## v2.7 additions

- Tic-Tac-Toe turns have a 30-second timer. If a player does not move, their turn is skipped and the opponent is pinged with a fresh 30-second turn. The deadline is stored in tournament state so it resumes safely after a restart.
- Tournament round headers use `<:SmileyTom:1537715428233715742>` instead of the game-console emoji.
- Discord-link filtering is explicitly disabled for channels and threads whose category is `1537689865666166859`, `1537689865666166861`, `1542835269240094730`, or `1544254003636994048`.


## v2.8 custom tournament emojis

- Tournament celebration uses `<:giveaway:1540636417577721927>` instead of the native party emoji.
- Support / claim buttons use `<:ticket:1540639436436406332>` as a real Discord custom component emoji.
- Champion references use `<a:Trophy_fixed:1545550040628461588>` instead of the native crown emoji.
- Existing SmileyTom round headers and the animated tournament trophy remain unchanged.


## v2.9 custom emoji resolver

- The configured ticket (`1540639436436406332`), giveaway (`1540636417577721927`) and Trophy_fixed (`1545550040628461588`) emojis are fetched from Discord by ID at startup.
- V2 button emojis now use the fetched GuildEmoji's exact name/animated metadata instead of only a hard-coded component object.
- Text displays build their custom-emoji markup from the fetched emoji metadata too.
- `/emojicheck` shows whether the bot can actually access each configured emoji and which connected server owns it.
- FAQ is rebuilt only after emoji resolution, so its support-ticket button uses the resolved custom ticket emoji immediately after startup.
