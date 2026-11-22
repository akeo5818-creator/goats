// Support tickets are already open. The assistant must not route customers back
// to the Tickets hub to resolve an issue raised in the current Support ticket.
// Pure and independent of discord.js, so it is straightforward to test.

const SUPPORT_TICKET = /^(?:website-)?support-/i;
const HUB_NAMED = /(?:#\s*(?:cash\s*[-_ ]*tickets?|tickets?)\b|\b(?:the\s+)?tickets?\s+(?:channel|hub|section|options)\b)/i;
const NEW_SUPPORT_TICKET = /\b(?:open|create|make|start|submit|file)\s+(?:(?:up|another|a|an|new|separate|fresh|different|your|the)\s+){0,3}(?:support\s+)?ticket\b/i;
const REFER_VERB = /\b(?:go|head|return|visit|open|create|start|submit|make|check|use|find|look|click|order|purchase|get help|wait|review|ask|see|send|take)\b/i;

function newPurchaseRequested(latest) {
  const text=String(latest||'').trim();
  // Asking about an existing/failed build, payment, or an earlier purchase is
  // not a request to open a second ticket.
  if (/\b(?:already|earlier|previously|tried|timed?\s*out|banned|refund|existing|my order|my build)\b/i.test(text)) return false;
  return /\b(?:where|how)\s+(?:can|could|do|would)\s+(?:i|we)\s+(?:buy|purchase|order|checkout|place\s+(?:an?\s+)?order)\b|\b(?:i(?:'d| would)?\s+like|i\s+want|i\s+need)\s+to\s+(?:buy|purchase|order|place\s+(?:an?\s+)?order)\b|\b(?:help\s+me\s+)?(?:place|make|start)\s+(?:a\s+)?new\s+(?:order|purchase)\b/i.test(text);
}

function looksLikeTicketHubReference(sentence, hubIds) {
  const mentioned=[...sentence.matchAll(/<#(\d{16,22})>/g)].map(m=>m[1]);
  return mentioned.some(id=>hubIds.has(id)) || HUB_NAMED.test(sentence);
}
function isCircularSupportSentence(sentence, hubIds) {
  const s=sentence.trim();
  if(!s) return false;
  if (NEW_SUPPORT_TICKET.test(s) && /\b(?:go|head|please|you|can|should|need|try|have|must|another|new|tickets?)\b/i.test(s)) return true;
  const hub=looksLikeTicketHubReference(s,hubIds);
  if(!hub) return false;
  if (REFER_VERB.test(s)) return true;
  if (/\b(?:here|there|link|ticket|order|support|channel|details|purchase)\b/i.test(s)) return true;
  return false;
}

/**
 * @param {string} answer Chat model's already-linked reply.
 * @param {object} details Verified message context, never supplied by the model.
 * @returns {{text:string, redirected:boolean}}
 */
export function keepSupportInCurrentTicket(answer, details={}) {
  const source=String(answer||'').trim();
  if (!SUPPORT_TICKET.test(String(details.channelName||''))) return {text:source,redirected:false};
  if (newPurchaseRequested(details.customerMessage)) return {text:source,redirected:false};
  const hubIds=new Set((details.ticketHubIds||[]).map(String));
  const timeOutDispute=/\b(?:timed?\s*out|timeout|bann?ed|muted|warned|kicked|moderation)\b/i.test(String(details.supportInquiry||'')+' '+String(details.customerMessage||''));
  // Keep original punctuation and paragraph boundaries as much as possible.
  const sentences=source.split(/(?<=[.!?])\s+|\n+/g).map(x=>x.trim()).filter(Boolean);
  let suppressed=false;
  const kept=[];
  for(const s of sentences) {
    if((timeOutDispute && /\b(?:for (?:a|your)?\s*build requests?|maximum\s+(?:usd\s+)?payment\s+budget|fill out (?:a|the) build form|submit (?:a|the) build request)\b/i.test(s)) ||
      isCircularSupportSentence(s,hubIds) ||
      (suppressed && /^(?:head|go|visit|open|create|click|follow)\s+(?:there|over|that|the|a|another|new)\b/i.test(s))) {
      suppressed=true;
      continue;
    }
    kept.push(s);
  }
  if(!suppressed) return {text:source,redirected:false};
  let cleaned=kept.join(' ').trim();
  // If the model gave nothing useful other than a referral, provide a safe
  // answer that doesn't pretend to have checked records or contacted staff.
  if (cleaned.length<26 || /^(?:okay|ok|gotcha|sure|thanks|sorry|alright|yep)[!., ]*$/i.test(cleaned)) {
    cleaned='You’re already in a Support ticket, so you don’t need to open another one. We can continue here. If this needs a staff review, I can help request one.';
  } else if (!/\b(?:this ticket|here in (?:the|this) ticket|already in (?:a|the) support ticket|continue here|right (?:support )?ticket)\b/i.test(cleaned)) {
    cleaned+=' We can continue helping you in this ticket.';
  }
  return {text:cleaned,redirected:true};
}
