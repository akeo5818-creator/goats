import assert from 'node:assert/strict';
import { keepSupportInCurrentTicket } from './src/support-ticket-guard.js';
const HUB='1537689865267974111';
const base={channelName:'support-bribeauty1',customerMessage:'I did that',ticketHubIds:[HUB]};
const tests=[
 ['support not to hub', 'Gotcha, thanks for confirming. Since you filled out the form, staff will need to check why you were timed out. Please wait for them to review it here: <#'+HUB+'>.', base, /Gotcha, thanks for confirming/, true],
 ['support without new ticket', 'Open a new support ticket for help.', base, /You’re already in a Support ticket/, true],
 ['wrong invented category', 'You can order or get help in #Cash Tickets. Head there to open a ticket!', base, /We can continue helping you in this ticket|You’re already in a Support ticket/, true],
 ['regular answer untouched', 'Staff can review what happened in this ticket. Can you tell me roughly when the timeout occurred?', base, /Staff can review what happened/, false],
 ['new purchase allowed', 'For a new purchase, use <#'+HUB+'>.', {...base,customerMessage:'Where can I purchase a new build?'}, /<#[0-9]+>/, false],
 ['cash tickets unaffected', 'Order here: <#'+HUB+'>.', {...base,channelName:'cash-alice'}, /<#[0-9]+>/, false],
 ['direct support staff request', 'Please use the Tickets channel to reach support.', base, /You’re already in a Support ticket/, true],
 ['mention of existing ticket is okay', 'You have already opened this ticket; staff can follow up here.',base,/You have already opened this ticket/,false],
 ['timeout build-intake diversion', 'Sorry about the timeout. For build requests please enter your payment budget. Staff can review your timeout here.', {...base,supportInquiry:'I got timed out trying to work with a builder'}, /Staff can review your timeout here/,true],
 ['timed out is not new purchase', 'For support, visit <#'+HUB+'>', {...base,customerMessage:'I tried to buy a build but was timed out'}, /You’re already in a Support ticket/,true],
];
for (const [name,answer,ctx,expect,changed] of tests){
 const actual=keepSupportInCurrentTicket(answer,ctx);
 assert.match(actual.text,expect,name);
 assert.equal(actual.redirected,changed,name);
 if(changed)assert.ok(!actual.text.includes(`<#${HUB}>`),name);
 console.log('PASS:',name);
}
