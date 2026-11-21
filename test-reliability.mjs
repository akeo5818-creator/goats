import assert from 'node:assert/strict';
import {ChannelType, PermissionFlagsBits} from 'discord.js';
import {setupAiAssistant} from './src/ai-assistant.js';
const guildId='1537689864827445278';
const botId='999999999999999999';
const ticketsId='144444444444444444';
const blockedId='133333333333333333';
let networkCalls=0;
globalThis.fetch=async (url)=>{
  if(!String(url).includes('frankfurter.dev'))throw Error('Unexpected network request');
  networkCalls++;
  return {ok:true, async json(){return {base:'USD',quote:'GBP',date:'2026-11-20',rate:0.78}}};
};
const everyone={id:'role-everyone'};
const member={id:'member',roles:{cache:new Map()},permissions:{has(){return false}}};
const botMember={id:botId};
const channelFactory=(name,id,{viewer=true,publicAccess=true}={})=>({
  id,name,type:ChannelType.GuildText,rawPosition:1,
  permissionsFor(who){return {has(flag){if(flag===PermissionFlagsBits.ViewChannel)return who===member?viewer:who===everyone?publicAccess:who===botMember?true:false;return true;}}},
  isThread(){return false;},
});
const ticketHub=channelFactory('tickets',ticketsId,{viewer:true,publicAccess:false});
const privateAdmin=channelFactory('staff-logs',blockedId,{viewer:false,publicAccess:false});
const talk=channelFactory('general','122222222222222222');
const messagesCache=new Map(); let index=0;
talk.guild=null;
talk.isTextBased=()=>true;
talk.sendTyping=async()=>{};
talk.messages={cache:messagesCache};
const channels=new Map([[ticketsId,ticketHub],[blockedId,privateAdmin],[talk.id,talk]]);
const guild={id:guildId,roles:{everyone},channels:{cache:channels,fetch:async()=>channels}};
for(const ch of channels.values())ch.guild=guild;
const client={user:botMember,guilds:{cache:new Map([[guildId,guild]])}};
const store={aiAssistant:{enabled:true,ticketAiEnabled:true,personality:'Use a friendly tone. Always include working Discord channel links.',knowledge:[],channelIds:[],histories:{},memorySummaries:{},memories:{},reportSchedules:{},supportTickets:{},learnedSources:{},adminCorrections:{},adminCorrectionVersions:{}}};
const captures=[];
let sentAnswers=[];
const ai=setupAiAssistant({client,guildId,getState:()=>store,persist:()=>{},callModel:async args=>{
  captures.push(args);
  if(String(args.history?.at(-1)?.content||'').includes('and in GBP?'))return 'At the reference rate, that is approximately £77.99 GBP.';
  if(String(args.history?.at(-1)?.content||'').includes('why did you not link'))return 'Because I missed the channel link earlier, sorry. Here is the Tickets channel.';
  if(String(args.history?.at(-1)?.content||'').includes('what is two times'))return 'Two times two is four.';
  if(String(args.history?.at(-1)?.content||'').includes('what payment methods'))return 'Please go to #Cash Tickets for payment information.';
  return '100M costs US$99.99. Open the Tickets channel.';
},apiConfigured:()=>true,adminIds:[],staffRoleIds:[],ticketBotId:'111111111111111111',modelName:'test'});
function msg(text,user,{replyTo=null}={}){
 const id=String(++index).padStart(18,'9');
 const message={id,author:{id:user,bot:false,username:user},guild,guildId,channel:talk,channelId:talk.id,member,content:text,cleanContent:text,
 mentions:{users:{has:(id)=>id===botId}},reference:replyTo?{messageId:replyTo.id}:null,
 fetchReference:replyTo?async()=>replyTo:null,attachments:new Map(),reply:async ({content})=>{
  sentAnswers.push({user,content}); const ans={id:'reply-'+index,author:{id:botId,bot:true},content,cleanContent:content}; messagesCache.set(ans.id,ans); return ans;
 }};
 messagesCache.set(id,message);
 return message;
}
const a=msg('How much does 100M cost?','user-a');await ai.handleMessage(a);
assert.match(sentAnswers.at(-1).content, new RegExp(`<#${ticketsId}>`),'actual ticket hub link used even when everyone cannot see it');
assert.doesNotMatch(sentAnswers.at(-1).content, /staff-logs/);
const b=msg('and in GBP?','user-a');await ai.handleMessage(b);
assert.match(captures.at(-1).instructions,/0\.780000 GBP/);
assert.match(captures.at(-1).instructions,/£77\.99 GBP/);
assert.match(captures.at(-1).instructions,/Use a friendly tone/);
assert.equal(networkCalls,1);
const lastBilly={id:'11111-billy-reply',author:{id:botId,bot:true},content:'Open the Tickets channel.',cleanContent:'Open the Tickets channel.'};
const c=msg('why did you not link it first?','user-a',{replyTo:lastBilly});await ai.handleMessage(c);
assert.match(captures.at(-1).instructions,/EXACT REFERENCED MESSAGE/);
assert.match(captures.at(-1).instructions,/Open the Tickets channel/);
const d=msg('what is two times two?','user-b');await ai.handleMessage(d);
const dHistory=captures.at(-1).history.map(t=>t.content).join('\n');
assert.doesNotMatch(dHistory,/100M costs|GBP/,'no cross-user conversation contamination');
assert.match(dHistory,/what is two times two/);
assert.match(captures.at(-1).instructions,/MOST RECENT ADMIN PERSONA RULES/);
assert.match(sentAnswers.at(-1).content,/four/);
const payment=msg('what payment methods do you accept?','user-a');await ai.handleMessage(payment);
assert.match(sentAnswers.at(-1).content,new RegExp(`<#${ticketsId}>`),'hallucinated #Cash Tickets replaced with real link');
const count=captures.length;
const huge='123456789123456789 * 987654321987654321';
const calc=msg(huge,'user-b');await ai.handleMessage(calc);
assert.equal(captures.length,count,'exact multiplication is computed locally, not sent to AI');
assert.match(sentAnswers.at(-1).content,/121932631356500531347203169112635269/);

console.log('PASS: clickable channel links; per-user context; direct-reply context; GBP conversion; personality prompt; no cross-user contamination');
