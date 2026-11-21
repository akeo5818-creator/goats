// Run `node test_censor_fix.js` from the project root after applying the patch.
// Tests the ACTUAL function in src/index.js without launching the bot.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const code = fs.readFileSync('src/index.js', 'utf8');
function functionSource(name) {
  const regexp = new RegExp('^function ' + name + '\\([^\\n]*?\\) \\{[\\s\\S]*?^\\}', 'm');
  const m = code.match(regexp);
  if (!m) throw new Error('Missing function ' + name);
  return m[0];
}
const state = { censoredTerms: ['daddy', 'badword'] };
const ctx = { state };
vm.createContext(ctx);
vm.runInContext(['normalizeCensorText','normalizeCensorTerm','findCensorMatch'].map(functionSource).join('\n\n'), ctx);
const match = s => vm.runInContext(`findCensorMatch(${JSON.stringify(s)})`, ctx);
for (const s of [
  'And add your helpfull but not pushy',
  'And add your helpful but not pushy',
  'And add your notes',
  'This is an ordinary chat',
  'granddaddy',
  'daddyish',
]) assert.equal(match(s), null, `false positive: ${s}`);
for (const s of [
  'daddy', 'DADDY!', 'd4ddy', 'd@ddy', 'd.a.d.d.y', 'd-a-d-d-y',
  'd a d d y', 'd_a_d_d_y', '(badword)', 'b4dword',
]) assert.ok(match(s), `failed to detect: ${s}`);
console.log('PASS: Cross-word false positives stopped; actual and obfuscated terms still match.');
