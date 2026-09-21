# Bloxburg Moderation Bot v2.22 - Scam Alert Channel + Live Server Profiles

This build keeps the Moderator visibility, PvP tournament visibility, and v2.21 AI reliability fixes, and upgrades Scam Alerts with a configurable destination channel plus automatic server-profile refreshes.

## AI chat

The bot can now have natural conversations with members in only the text channels you choose. The configured channel list and personality are saved in the normal persistent `state.json`. Recent conversational context is kept short-term in memory so the AI can follow the current discussion without permanently writing chat transcripts into the state file.

### Commands

- `/aichat add channel:#channel` - enable automatic AI replies in a text channel.
- `/aichat remove channel:#channel` - remove a channel.
- `/aichat list` - list configured AI channels.
- `/aichat status` - show whether AI is enabled, whether the API key is configured, the model, and channels.
- `/aichat test` - make a live API request and show staff the exact failure code if it cannot reply.
- `/aichat enable enabled:true|false` - pause/resume AI globally without deleting the channel list.
- `/aichat personality instructions:...` - customize how the AI talks.
- `/aichat resetpersonality` - restore the default Blox & Co. personality.
- `/aichat reset [channel]` - clear short-term AI conversation context for one or all AI channels.

`/aichat` uses the same stable Moderator command visibility system as mute/timeout/etc., including Moderator role `1543902943009312870`.

## Railway variables for AI

Required for AI replies:

```env
OPENAI_API_KEY=your_api_key_here
```

Optional:

```env
AI_MODEL=gpt-5.6-luna
AI_MAX_OUTPUT_TOKENS=500
AI_USER_COOLDOWN_MS=2500
```

The bot uses Node's built-in `fetch`, so no extra npm dependency is required. If the key is missing, the rest of the moderation bot still runs normally and `/aichat status` will show `API Key: Missing`.

## Existing v2.19 fixes retained

- Moderator role `1543902943009312870` stays eligible for the moderation slash commands across channels.
- `/mute` and `/unmute` aliases remain available alongside timeout commands.
- PvP tournament channels remain visible to Customer roles when a tournament is closed/cancelled; chat becomes read-only rather than invisible.
- Tournament visibility is re-applied when tournament mode changes.

## Deploy

```bash
npm run check
git add .
git commit -m "Add configurable scam alert channel and live server profile refresh"
git push
```

### AI reliability in v2.21
AI chat uses `reasoning.effort: none` for fast Discord replies and retries temporary 429/5xx/network failures up to 3 attempts while respecting `Retry-After`. Billing/quota errors are not repeatedly retried.


## Scam Alerts in v2.22

- `/scamalert setchannel channel:#channel` changes the live Scam Alerts destination and saves it in persistent state.
- Changing the channel automatically reposts every saved alert into the new channel without pinging subscribers again. The old alert post is deleted only after the replacement was successfully posted.
- `/scamalert repost id:SA-0001` still reposts a single alert to the currently configured Scam Alerts channel.
- `SCAM_ALERTS_CHANNEL_ID` is now only the initial/fallback channel. A channel chosen with `/scamalert setchannel` survives Railway restarts.
- Server profiles resolved from invites privately retain the invite code in bot state so the bot can re-resolve the server later. Invite codes are never rendered in the public Scam Alert.
- Every 10 minutes, saved server profiles are checked for changes. If the server icon, name, description, counts, or resolved owner profile changes, the existing Scam Alert message is edited automatically.
- Legacy external server profiles from older builds may need `/scamalert addserver` run once again with a valid invite so the bot has a private invite code for future refreshes.
