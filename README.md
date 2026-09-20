# Bloxburg Moderation Bot v2.20 - AI Chat Channels

This build keeps the v2.19 Moderator visibility and PvP tournament visibility fixes, and adds configurable AI chat channels for Blox & Co.

## AI chat

The bot can now have natural conversations with members in only the text channels you choose. The configured channel list and personality are saved in the normal persistent `state.json`. Recent conversational context is kept short-term in memory so the AI can follow the current discussion without permanently writing chat transcripts into the state file.

### Commands

- `/aichat add channel:#channel` - enable automatic AI replies in a text channel.
- `/aichat remove channel:#channel` - remove a channel.
- `/aichat list` - list configured AI channels.
- `/aichat status` - show whether AI is enabled, whether the API key is configured, the model, and channels.
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
git commit -m "Add configurable AI chat channels"
git push
```
