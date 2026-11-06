import test from 'node:test';
import assert from 'node:assert/strict';
import {activityDomains} from '../shared/activity-domains.js';
import {parseEventTypes} from '../server/event-types.js';
import {openDb,readData,saveImport} from '../server/db.js';
import {createApp} from '../server/app.js';
import {HEADERS,parseRows,inspectImport} from '../server/domain.js';
test('activity domains combine primary and secondary classifications once, with primary first',()=>{
 assert.deepEqual(activityDomains('Physical',['Cognitive']),['Physical','Cognitive']);
 assert.deepEqual(activityDomains('Cognitive',['Cognitive+Social']),['Cognitive','Social']);
 assert.deepEqual(activityDomains('Cognitive',['Cognitive & Social']),['Cognitive','Social']);
 assert.deepEqual(activityDomains('Physical',['Social & Cognitive, Learning','Physical + Cognitive','Learning']),['Physical','Social','Cognitive','Learning']);
 assert.deepEqual(activityDomains(' Cognitive ',[' cognitive + SOCIAL ','Social','COGNITIVE']),['Cognitive','SOCIAL']);
});
test('display deduplication preserves import labels, meaningful compound names and unknown handling',()=>{
 const raw=['Cognitive & Social','Self care and mindfulness'];const before=structuredClone(raw);
 assert.deepEqual(activityDomains('Social – Communal Dining',raw),['Social – Communal Dining','Cognitive','Social','Self care and mindfulness']);
 assert.deepEqual(raw,before);assert.deepEqual(parseEventTypes('Cognitive & Social, Learning'),['Cognitive & Social','Learning']);
 assert.deepEqual(activityDomains('Physical',['Unclassified / unknown','']),['Physical']);
 assert.deepEqual(activityDomains(null,[]),['Unclassified / unknown']);
});
test('programme CSV and printable reports use the same combined domains without altering source classifications or attendance',async()=>{
 const db=openDb(':memory:'),app=createApp(db),actor=db.prepare("SELECT id FROM users WHERE username='__local_workspace__'").get().id;
 const parsed=parseRows([[...HEADERS,'Activity Name/Event Type'],...Array.from({length:10},(_,i)=>['member-'+i,'MALE','65','CHINESE','1-3','YES','YES','Activity','Cognitive','2026-11-01, 09:00 AM - 10:00 AM','Cognitive+Social'])]);saveImport(db,parsed,inspectImport(parsed,readData(db)),actor);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{const csv=await fetch(base+'/api/export/csv');assert.equal(csv.status,200);const text=await csv.text();assert.match(text,/"Domains"/);assert.match(text,/"Cognitive, Social"/);const html=await fetch(base+'/api/export/report');assert.equal(html.status,200);assert.match(await html.text(),/<td>Cognitive, Social<\/td>/);const state=readData(db);assert.equal(state.attendance.length,10);assert.equal(state.programmes[0].domain,'Cognitive');assert.equal(state.sessions[0].optional.eventTypeRaw,'Cognitive+Social');assert.deepEqual(state.sessions[0].optional.eventTypes,['Cognitive+Social']);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
});
