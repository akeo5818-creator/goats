import assert from 'node:assert/strict';
import {
  aiConversationBlocked, ignoredPersonCommand, paymentMethodsInfoChannel, sensitiveKnowledgeChannel,
} from './ai-access-controls.js';

const bot='1573536368880128050', user='1403263605142458389';
const cases = [
  ['Ignore a mentioned member', () => assert.deepEqual(ignoredPersonCommand(`<@${bot}> Ignore <@${user}> from now on`,bot),{operation:'add',userId:user})],
  ['Ignore normal spoken instruction', () => assert.deepEqual(ignoredPersonCommand(`<@${bot}> do not reply to <@${user}>`,bot),{operation:'add',userId:user})],
  ['Unignore a member', () => assert.deepEqual(ignoredPersonCommand(`<@${bot}> stop ignoring <@${user}>`,bot),{operation:'remove',userId:user})],
  ['Do not save casual conversation as an ignore', () => assert.equal(ignoredPersonCommand(`<@${bot}> hi <@${user}>`,bot),null)],
  ['Non-admin DMs are silent', () => assert.equal(aiConversationBlocked({isDm:true,dmAdmin:false}),true)],
  ['Admin DMs stay enabled', () => assert.equal(aiConversationBlocked({isDm:true,dmAdmin:true}),false)],
  ['Ignored users get no casual replies', () => assert.equal(aiConversationBlocked({userId:user,ignoredIds:[user]}),true)],
  ['Channel mute includes mentions and replies', () => assert.equal(aiConversationBlocked({channelId:'123',mutedChannelIds:['123']}),true)],
  ['Other channels remain available', () => assert.equal(aiConversationBlocked({userId:user,channelId:'124',ignoredIds:[],mutedChannelIds:['123']}),false)],
  ['Payment-methods is an information source', () => assert.equal(paymentMethodsInfoChannel('payment-methods'),true)],
  ['Private payment methods default to restricted', () => assert.equal(sensitiveKnowledgeChannel('payment-methods'),true)],
  ['Customer tickets remain sensitive', () => assert.equal(sensitiveKnowledgeChannel('support-bribeauty1'),true)],
  ['Public services are not sensitive', () => assert.equal(sensitiveKnowledgeChannel('services'),false)],
];
for(const [name,fn] of cases){fn();console.log('PASS:',name)}
console.log(`All ${cases.length} policy tests passed.`);
