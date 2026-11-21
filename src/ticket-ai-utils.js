import { OverwriteType, PermissionFlagsBits } from 'discord.js';

// A ticket owner can also be a Discord administrator or moderator. An explicit
// per-user ViewChannel overwrite distinguishes them from staff who only have
// access through a staff role (as in the Bloxburg Store ticket bot).
export function isTicketParticipant(message) {
  const authorId = String(message?.author?.id || '');
  if (!authorId || message?.author?.bot) return false;
  const direct = message.channel?.permissionOverwrites?.cache?.get(authorId);
  if (direct?.type === OverwriteType.Member && direct.allow?.has?.(PermissionFlagsBits.ViewChannel)) return true;
  const topicMatch = String(message.channel?.topic || '').match(/(?:^|\|)\s*Customer\s+(\d{16,22})\b/i);
  return topicMatch?.[1] === authorId;
}

// Deterministic routing, not an AI model judgment: a customer asking for an
// actual human is always allowed to leave the automated conversation.
export function wantsHumanStaff(text) {
  const value = String(text || '').replace(/<@!?\d{16,22}>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!value) return false;
  return /\b(?:human|real person|actual person|live agent|live support|human agent)\s*(?:please|pls|now)?[!?.]*$/i.test(value)
    || /\b(?:want|need|prefer|request|speak(?:ing)? to|talk(?:ing)? to|chat(?:ting)? with|transfer(?: me)? to|connect(?: me)? (?:to|with)|get|bring|call|ping|contact|notify|ask for|let me (?:talk|speak) to)\b.{0,75}\b(?:human|real person|actual person|live agent|person|staff|mod(?:erator)?|support team|employee|representative)\b/i.test(value)
    || /\b(?:can|could|may|would)\s+(?:i|you|we|someone)\b.{0,90}\b(?:human|real person|actual person|live agent|staff|mod(?:erator)?|support team|representative|take over)\b/i.test(value)
    || /\b(?:staff|moderator|mod|human|real person)\s+(?:please|pls|help|take over|needed|now)\b/i.test(value)
    || /\b(?:i(?:'d| would) (?:like|prefer) (?:to (?:speak|talk) (?:to|with) )?(?:a |an )?(?:human|real person|actual person|staff|moderator|live agent))\b/i.test(value)
    || /\b(?:no more ai|no ai|stop (?:the )?(?:ai|bot)|don't want (?:the )?(?:ai|bot)|do not want (?:the )?(?:ai|bot))\b/i.test(value);
}

// Send exactly one role ping, then persist staff takeover. If Discord cannot
// deliver the ping (or the role is missing), do not silently mark handoff done.
export async function handoffToHuman({ channel, session, roleId, label, persist }) {
  if (session.escalated || (session.paused && !session.handoffPending)) return true;
  const validRole = /^\d{16,22}$/.test(String(roleId || ''));
  const text = validRole
    ? `Of course! I'll hand this ticket to a human. <@&${roleId}> — a customer has requested staff help in this ${label} ticket. I'll stop responding here.`
    : `I can hand this over to a human, but my ${label} staff role isn't configured. Please tag a staff member in this ticket. I've alerted the bot administrators in the logs.`;
  try {
    await channel.send({ content: text, allowedMentions: { parse: [], roles: validRole ? [roleId] : [] } });
  } catch (error) {
    console.error(`[TICKET AI] ${label} staff handoff message failed in ${channel.id}:`, error?.message || error);
    session.handoffPending = false;
    persist();
    return false;
  }
  if (!validRole) {
    console.error(`[TICKET AI] Missing ${label} escalation role. Configure AI_MODERATOR_ROLE_ID/AI_TICKET_STAFF_ROLE_ID.`);
    session.handoffPending = false;
    persist();
    return false;
  }
  session.paused = true;
  session.handoffPending = false;
  session.escalated = true;
  session.updatedAt = Date.now();
  persist();
  return true;
}

// Customers should not be left with silence if the model is misconfigured or
// temporarily unavailable. Rate-limit this notice per ticket to avoid spam.
export async function notifyTicketAiUnavailable({ channel, session, persist }) {
  const now = Date.now();
  if (session.paused || session.handoffPending || now - Number(session.lastErrorNoticeAt || 0) < 300_000) return;
  try {
    await channel.send({
      content: "I'm having trouble responding automatically at the moment. If you'd like a team member, say **human** and I'll notify staff here.",
      allowedMentions: { parse: [] },
    });
    session.lastErrorNoticeAt = now;
    persist();
  } catch (error) {
    console.warn(`[TICKET AI] Could not send availability notice in ${channel.id}:`, error?.message || error);
  }
}
