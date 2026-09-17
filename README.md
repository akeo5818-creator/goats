# Bloxburg Moderation Bot v2.18 - Customer Role Fix

Adds `/customerrolefix [preview:true|false]` (Administrator-only).

Only non-bot members with role `1537689864827445285` are considered.

They are untouched if they have role `1537689864827445286`, or ANY of these safe roles:

- `1540199715470315530`
- `1543902943009312870`
- `1537689864827445287`

Everyone else gets role `1542046269290315797` added FIRST, then role `1537689864827445285` removed.

## Apply

Put `apply-v2.18-role-cleanup.mjs` beside `package.json` and run:

```bash
node apply-v2.18-role-cleanup.mjs
npm run check
```

Then:

```bash
git add .
git commit -m "Add customer role fix command"
git push
```

Recommended first run: `/customerrolefix preview:true`

Then run `/customerrolefix` for the real change.
