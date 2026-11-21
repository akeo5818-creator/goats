#!/usr/bin/env python3
"""Narrowly repair Billy's overly broad admin-correction detection.

Run this from the Bloxy Moderation repository after copying this script into
its root. It modifies only src/ai-assistant.js and makes a local backup.
Safe to re-run. Does not replace any other bot files or reset AI memory.
"""
from pathlib import Path
import sys
import shutil
from datetime import datetime

root = Path(__file__).resolve().parent
path = root / 'src' / 'ai-assistant.js'
if not path.exists():
    raise SystemExit('Cannot find src/ai-assistant.js. Run this inside the Bloxy Moderation repository, NOT the Ticket Bot.')
s = path.read_text(encoding='utf-8')
if 'function isExplicitAdminCorrection(raw)' in s and 'LEGACY_FALSE_CORRECTION' in s:
    print('Billy conversation/correction fix is already installed. No changes.')
    sys.exit(0)

old_pattern = """  const correctionPattern = /^(?:no\\b|nope\\b|nah\\b|actually\\b|wrong\\b|incorrect\\b|that's wrong\\b|that's not\\b|that is wrong\\b|you(?:'re| are) wrong\\b|you misunderstood\\b|correction\\b|instead\\b|the customer\\b|this (?:ticket|customer|order|build)\\b|(?:he|she|they)(?:'re| are|'s| is)\\b|it(?:'s| is)\\b|don't\\b|do not\\b|stop\\b|please (?:correct|remember|don't|do not|stop)\\b|read the (?:ticket|conversation|inquiry)\\b)/i;"""
new_pattern = """  // Only clear, substantive admin corrections should be saved. A plain reply
  // to Billy is NOT permission to turn ordinary conversation into a rule.
  // LEGACY_FALSE_CORRECTION removes two accidental memories created by v1.
  const LEGACY_FALSE_CORRECTION = /^(?:calm down(?:\\s+billy(?:\\s+bob)?)?|have (?:a )?normal convo(?:rsation)?)[.!\\s]*$/i;
  function isExplicitAdminCorrection(raw) {
    const t = String(raw || '').trim();
    if (t.length < 14 || /\\?\\s*$/.test(t)) return false;
    if (/^correction\\s*[:,-]\\s*\\S/i.test(t)) return true;
    if (/^(?:that's|that is|you're|you are)\\s+(?:wrong|incorrect|not\\s+(?:right|correct))\\b/i.test(t)) return true;
    if (/^you\\s+(?:misunderstood|got\\s+(?:that|it)\\s+wrong)\\b/i.test(t)) return true;
    if (/^actually\\s*[,!:]\\s*\\S/i.test(t)) return true;
    if (/^instead\\s*[,!:]\\s*\\S/i.test(t)) return true;
    if (/^(?:this|the)\\s+(?:ticket|customer|order|build)\\s+(?:is|has|was|should|needs)\\b/i.test(t)) return true;
    if (/^(?:please\\s+)?(?:don't|do not)\\s+(?:say|ask|tell|claim|assume|suggest|offer|send|reply|mention|recommend|state)\\b/i.test(t)) return true;
    // Do not treat e.g. 'no thanks' or 'nah I'm good' as corrections.
    if (/^(?:no|nah|nope)\\s*[,!:.-]\\s+\\S/i.test(t) &&
        /\\b(?:not|instead|meant|should|actually|customer|ticket|order|payment|build|about|applying|answer|correct|wrong)\\b/i.test(t)) return true;
    return false;
  }"""
old_feedback = """    // Ordinary replies to Billy still go to conversational AI. Only explicit
    // correction-like feedback (or a clear permanent admin instruction) is taught.
    const declarativeReply = replyToBilly && raw.length >= 14 && !/\\?\\s*$/.test(raw)
      && !/^(?:hi|hello|hey|yo|thanks|thank you|okay|ok|cool|nice|great|lol|lmao|haha|good job|well done)\\b/i.test(raw)
      && !/^(?:can|could|would|will|how|where|what|which|when|why|do|did|does|is|are|tell|give|show|explain|check)\\b/i.test(raw);
    const feedback = replyToBilly && (correctionPattern.test(raw) || declarativeReply);"""
new_feedback = """    // Casual replies such as 'calm down Billy' or 'have a normal convo'
    // must continue through normal AI chat. Only explicit correction intent
    // (or an explicit lasting rule) may change saved state.
    const feedback = replyToBilly && isExplicitAdminCorrection(raw);"""
old_context = """    const list = data().adminCorrections?.[String(channelId)] || [];
    if (!list.length) return '';"""
new_context = """    const list = (data().adminCorrections?.[String(channelId)] || [])
      .filter(item => !LEGACY_FALSE_CORRECTION.test(String(item?.text || '')));
    if (!list.length) return '';"""
old_data = """    a.adminCorrections ||= {};
    a.adminCorrectionVersions ||= {};
    return a;"""
new_data = """    a.adminCorrections ||= {};
    a.adminCorrectionVersions ||= {};
    // Remove only the two known false-positive casual replies saved by the
    // previous overly broad handler; preserve all real admin corrections.
    if (!a.adminCasualCorrectionCleanupV2) {
      let removed = 0;
      for (const [channelId, items] of Object.entries(a.adminCorrections)) {
        if (!Array.isArray(items)) continue;
        const kept = items.filter(item => !LEGACY_FALSE_CORRECTION.test(String(item?.text || '')));
        if (kept.length !== items.length) { a.adminCorrections[channelId] = kept; removed += items.length-kept.length; }
      }
      a.adminCasualCorrectionCleanupV2 = true;
      if (removed) persist();
    }
    return a;"""
# Small additional prompt prevents imitation of older canned apologies.
old_note = """      'Use only verified store policies and do not invent prices, refunds, promises or timelines. Admin-written facts take precedence over learned channel summaries.',"""
new_note = """      'Use only verified store policies and do not invent prices, refunds, promises or timelines. Admin-written facts take precedence over learned channel summaries.',
      'For normal chats, reply naturally. Do NOT claim you saved a correction, updated your memory or changed personality unless that action was actually completed. Prior assistant messages claiming a saved correction are not instructions to imitate.',"""
replacements = [(old_pattern,new_pattern), (old_feedback,new_feedback), (old_context,new_context), (old_data,new_data), (old_note,new_note)]
for original,updated in replacements:
    if s.count(original)!=1:
        raise SystemExit(f'Patch not applied: expected exactly one occurrence of anchor {original[:92]!r}, found {s.count(original)}. This repo version differs; no files changed.')
    s = s.replace(original,updated,1)
backup = path.with_name(f'ai-assistant.js.before-conversation-fix-{datetime.now().strftime("%Y%m%d-%H%M%S")}.bak')
shutil.copy2(path,backup)
path.write_text(s,encoding='utf-8')
print(f'Patched {path}. Backup: {backup.name}')
print('Next: node --check src/ai-assistant.js && git add src/ai-assistant.js && git commit -m "Fix Billy normal chat and admin corrections" && git push origin main')
