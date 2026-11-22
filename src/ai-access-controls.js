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

function adminControlText(content, botId = '') {
  const src = String(content || '').trim();
  const bot = String(botId || '');
  let text = SNOWFLAKE.test(bot)
    ? src.replace(new RegExp(`^<@!?${bot}>\\s*[,!:]?\\s*`), '').trim()
    : src;
  // Verified-admin authentication happens before these parsers run. This only
  // makes natural admin phrasing less brittle; it never trusts the words
  // "I am an admin" as authorization.
  text = text.replace(/^(?:(?:i(?:['’]m| am)|as)\s+(?:the\s+)?(?:server\s+)?(?:owner|an?\s+admin(?:istrator)?)\s*[,;:.-]?\s*)+/i, '').trim();
  return text;
}

export function ignoredPersonCommand(content, botId = '') {
  let text = adminControlText(content, botId);
  // Accept natural verified-admin wrappers such as:
  // "make sure you ignore @user" / "I want you to stop ignoring @user".
  text = text.replace(/^(?:please\s+)?(?:(?:make\s+sure(?:\s+you)?|ensure(?:\s+that)?|i\s+(?:want|need)\s+you\s+to|you\s+(?:need\s+to|should|must)|can\s+you|could\s+you)\s+)/i, '').trim();

  // Unignore must be checked first so "stop ignoring" can never be parsed as
  // an ignore/add operation.
  let match = text.match(/^(?:please\s+)?(?:unignore|stop\s+ignoring|start\s+(?:talking|responding|replying)\s+to|(?:do\s+)?(?:talk|reply|respond)\s+to)\s+<@!?(\d{16,22})>(?:\s+(?:again|from\s+now\s+on|in\s+(?:all|every)\s+channels?))?[.!,\s]*$/i);
  if (match) return {operation:'remove',userId:match[1]};

  match = text.match(/^(?:please\s+)?(?:ignore|stop\s+(?:talking|responding|replying)\s+to|(?:don['’]t|do\s+not)\s+(?:talk|reply|respond)\s+to)\s+<@!?(\d{16,22})>(?:\s+(?:from\s+now\s+on|forever|in\s+(?:all|every)\s+channels?))?[.!,\s]*$/i);
  if (match) return {operation:'add', userId:match[1]};
  return null;
}

export function ignoredPersonStatusQuery(content, botId = '') {
  const text = adminControlText(content, botId);
  let match = text.match(/^(?:do\s+you\s+(?:currently\s+)?ignore|are\s+you\s+(?:currently\s+)?ignoring|have\s+you\s+ignored)\s+<@!?(\d{16,22})>(?:\s+or\s+not)?[?.!,\s]*$/i);
  if (match) return {userId:match[1]};
  match = text.match(/^(?:is\s+<@!?(\d{16,22})>\s+(?:currently\s+)?ignored|is\s+<@!?(\d{16,22})>\s+on\s+(?:your\s+)?ignore\s+list)[?.!,\s]*$/i);
  if (match) return {userId:match[1] || match[2]};
  return null;
}

export function aiConversationBlocked({isDm=false, dmAdmin=false, userId='', channelId='', ignoredIds=[], mutedChannelIds=[]}={}) {
  if (isDm) return !dmAdmin; // never send a normal AI reply to a non-admin DM
  return ignoredIds.includes(String(userId)) || mutedChannelIds.includes(String(channelId));
}
