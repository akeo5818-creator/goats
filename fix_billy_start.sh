#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package.json || ! -f src/index.js ]]; then
  echo 'ERROR: Run this from the bloxy-moderation-bot folder (containing package.json and src/index.js).' >&2
  exit 1
fi

backup="package.json.before-start-fix.$(date +%Y%m%d-%H%M%S).bak"
cp package.json "$backup"
echo "Backed up original to $backup"

# npm pkg set modifies only listed keys; it preserves every other package.json field.
npm pkg set \
  'name=bloxy-moderation-bot' \
  'version=2.26.0' \
  'type=module' \
  'scripts.start=node --env-file-if-exists=.env src/index.js' \
  'dependencies[discord.js]=^14.27.0' \
  'engines.node=>=22.0.0'
npm pkg set --json 'private=true'

node --check src/index.js
node - <<'JS'
const p = require('./package.json');
if (p.scripts?.start !== 'node --env-file-if-exists=.env src/index.js') throw new Error('Missing startup command');
if (p.dependencies?.['discord.js'] !== '^14.27.0') throw new Error('discord.js dependency missing');
if (p.type !== 'module') throw new Error('ES module setting missing');
console.log('Verified package.json:', p.scripts.start);
JS

echo 'Startup configuration repaired. To deploy: git add package.json && git commit -m "Restore Billy startup script" && git push origin main'
