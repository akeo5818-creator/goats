#!/usr/bin/env python3
"""Safe, narrow fix for Billy's circular Support-ticket referrals."""
from pathlib import Path
from datetime import datetime, timezone
import subprocess, shutil, sys

root = Path.cwd()
source = root / 'src' / 'ai-assistant.js'
target = root / 'src' / 'support-ticket-guard.js'
helper = Path(__file__).resolve().parent / 'support-ticket-guard.js'
if not source.is_file():
    sys.exit('ERROR: Run from the Bloxy Moderation repository root (src/ai-assistant.js not found).')
if not helper.is_file():
    sys.exit('ERROR: Keep support-ticket-guard.js beside the installer.')

original = source.read_text(encoding='utf-8')
if "from './support-ticket-guard.js'" in original:
    sys.exit('Already installed. No changes made.')

changes = [
  (
    "import { setupTicketActions } from './ticket-actions.js';",
    "import { setupTicketActions } from './ticket-actions.js';\nimport { keepSupportInCurrentTicket } from './support-ticket-guard.js';",
  ),
  (
    "? 'You are providing customer Support assistance.'",
    "? 'You are helping a customer INSIDE an already-open Support ticket. Handle their issue in this ticket. NEVER tell them to open another Support ticket, return to the Tickets hub, or wait in the Tickets channel. If their issue needs moderator/staff review, explain that staff can review it here and offer human handoff; never claim you checked a timeout reason without access. Do not restart Build intake or request a payment budget for a timeout/support dispute. Only mention a purchase entrypoint when the customer explicitly asks to place a NEW order.'",
  ),
  (
    "const reply = safe(enforceDiscordChannelLinks(aiResult?.reply,message,client.user));",
    """const linkedReply = safe(enforceDiscordChannelLinks(aiResult?.reply,message,client.user));
        // Enforce ticket navigation in code, NOT just by personality instructions.
        // For support issues we never send someone back to the ticket hub.
        const supportPolicy = kind === 'support'
          ? keepSupportInCurrentTicket(linkedReply, {
              channelName: message.channel?.name,
              customerMessage: content,
              supportInquiry: supportSession(message.channelId).openingInquiry || '',
              ticketHubIds: [...(message.guild?.channels?.cache?.values?.() || [])]
                .filter(isTicketHub).map(channel => channel.id),
            })
          : { text: linkedReply, redirected: false };
        const reply = safe(supportPolicy.text);
        if (supportPolicy.redirected) console.warn(`[AI SUPPORT GUARD] Removed circular Tickets referral in ${message.channelId}`);""",
  ),
  (
    "if(kind==='support' && aiResult?.resolved===true && !entry.paused && !entry.handoffPending)",
    "if(kind==='support' && aiResult?.resolved===true && !supportPolicy.redirected && !entry.paused && !entry.handoffPending)",
  ),
]
updated = original
for needle, replacement in changes:
    count = updated.count(needle)
    if count != 1:
        sys.exit(f'ERROR: Expected one matching source anchor (found {count}): {needle[:95]!r}. No changes made. Your source may be newer; do not force this patch.')
    updated = updated.replace(needle, replacement, 1)
if target.exists():
    sys.exit('ERROR: src/support-ticket-guard.js already exists. Review it before overwriting. No changes made.')

# Syntax-check temporary copies before changing the working tree.
import tempfile
with tempfile.TemporaryDirectory(prefix='billy-support-check-') as d:
    folder = Path(d)
    test_source = folder / 'ai-assistant.mjs'
    test_guard = folder / 'support-ticket-guard.mjs'
    test_source.write_text(updated, encoding='utf-8')
    test_guard.write_text(helper.read_text(encoding='utf-8'))
    for f in (test_source, test_guard):
        chk = subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
        if chk.returncode:
            sys.exit('ERROR: JavaScript syntax check failed; no files changed.\n' + chk.stderr)

backup = root / '.billy-support-fix-backups' / datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(source,backup / 'ai-assistant.js')
try:
    source.write_text(updated, encoding='utf-8')
    shutil.copy2(helper,target)
except Exception as exc:
    shutil.copy2(backup/'ai-assistant.js',source)
    if target.exists(): target.unlink()
    sys.exit(f'ERROR: Installation failed and original restored: {exc}')
print('SUCCESS: Billy Support referral fix installed.')
print('Changed: src/ai-assistant.js; created: src/support-ticket-guard.js')
print('Backup:', backup)
print('Next: node --check src/ai-assistant.js && node test-support-ticket.mjs')
