// Pure, testable policies for Billy's channel and administrator controls.
const SNOWFLAKE = /^\d{16,22}$/;

export function paymentMethodsInfoChannel(name) {
  return /^payment[-_\s]*methods?$/i.test(String(name || '').trim());
}

export function sensitiveKnowledgeChannel(name) {
  const value = String(name || '');
  return /(?:staff|admin|moderation|mod.?log|logs?|audit|ticket|payment|invoice|receipt|finance|bank|security|verification|report|transcript|order.?data|customer|vouch.?log)/i.test(value)
    || /^(?:website-)?(?:build|builds|support|cash|purchase|robux|blockbux)-/i.test(value);
}

export function ignoredPersonCommand(content, botId = '') {
  const src = String(content || '').trim();
  const bot = String(botId || '');
  const text = SNOWFLAKE.test(bot)
    ? src.replace(new RegExp(`^<@!?${bot}>\\s*[,!:]?\\s*`), '').trim()
    : src;
  let match = text.match(/^(?:please\s+)?(?:ignore|stop\s+(?:talking|responding|replying)\s+to|(?:don['’]t|do\s+not)\s+(?:talk|reply|respond)\s+to)\s+<@!?(\d{16,22})>(?:\s+(?:from\s+now\s+on|forever|in\s+(?:all|every)\s+channels?))?[.!\s]*$/i);
  if (match) return {operation:'add', userId:match[1]};
  match = text.match(/^(?:please\s+)?(?:unignore|stop\s+ignoring|start\s+(?:talking|responding|replying)\s+to|talk\s+to|reply\s+to)\s+<@!?(\d{16,22})>(?:\s+(?:again|from\s+now\s+on))?[.!\s]*$/i);
  if (match) return {operation:'remove',userId:match[1]};
  return null;
}

export function aiConversationBlocked({isDm=false, dmAdmin=false, userId='', channelId='', ignoredIds=[], mutedChannelIds=[]}={}) {
  if (isDm) return !dmAdmin; // never send a normal AI reply to a non-admin DM
  return ignoredIds.includes(String(userId)) || mutedChannelIds.includes(String(channelId));
}
