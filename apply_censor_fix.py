#!/usr/bin/env python3
"""Non-destructive fix for Bloxy censor's cross-word false positives.
Run from Bloxy project root: python3 apply_censor_fix.py
"""
from pathlib import Path
import re
import shutil
import sys
from datetime import datetime, timezone

TARGET = Path('src/index.js')
PATTERN = re.compile(r'^function findCensorMatch\(content\) \{[\s\S]*?^\}', re.MULTILINE)
REPLACEMENT = r'''function findCensorMatch(content) {
  const base = normalizeCensorText(content);
  // Never collapse whitespace between different words. Previously the text
  // "And add your" was collapsed to "andaddyour", triggering "daddy".
  // Only collapse punctuation inside an individual whitespace-delimited part,
  // and require the result to be an entire word rather than a substring.
  const tokens = String(content || '').normalize('NFKD').split(/\s+/u)
    .map(part => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .map(part => normalizeCensorText(part).replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

  // Explicitly spaced-out letters are a common deliberate bypass, e.g.
  // "d a d d y". Match these only when EVERY original token is one letter;
  // do not glue normal words such as "and add your" together.
  const letterTokens = base.match(/[a-z0-9]+/g) || [];

  for (const original of state.censoredTerms || []) {
    const term = normalizeCensorTerm(original);
    if (!term) continue;
    const termCompact = term.replace(/ /g, '');
    if (!termCompact) continue;

    // Exact full-word matches, including standard leetspeak (d4ddy) and
    // punctuation-only obfuscation (d.a.d.d.y or d-a-d-d-y).
    if (tokens.includes(termCompact)) return original;

    // Spaced single-character bypasses (d a d d y) without joining normal
    // multi-character words. Avoid accidental matching of short terms.
    if (termCompact.length >= 4) {
      for (let i = 0; i <= letterTokens.length - termCompact.length; i++) {
        const run = letterTokens.slice(i, i + termCompact.length);
        if (run.every(part => part.length === 1) && run.join('') === termCompact) {
          return original;
        }
      }
    }
  }
  return null;
}'''


def main():
    if not TARGET.is_file():
        print('ERROR: src/index.js not found. Run in the Bloxy Moderation repository root.', file=sys.stderr)
        return 1
    source = TARGET.read_text(encoding='utf-8')
    m = PATTERN.search(source)
    if not m:
        print('ERROR: findCensorMatch(content) not found; refusing to change unknown code.', file=sys.stderr)
        return 1
    old = m.group(0)
    if old == REPLACEMENT or 'Never collapse whitespace between different words' in old:
        print('Already fixed; no changes made.')
        return 0
    if 'const compact = base.replace' not in old or 'compact.includes(termCompact)' not in old:
        print('ERROR: Your matcher differs from the verified version; refusing an unsafe patch.', file=sys.stderr)
        return 1
    backup_dir = Path('.bloxy-patch-backups')
    backup_dir.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = backup_dir / f'index.js.{stamp}.bak'
    shutil.copy2(TARGET, backup)
    TARGET.write_text(source[:m.start()] + REPLACEMENT + source[m.end():], encoding='utf-8')
    print('Patched src/index.js: censor no longer matches across separate words.')
    print(f'Backup saved to {backup} (do not commit this backup).')
    return 0

if __name__ == '__main__':
    sys.exit(main())
