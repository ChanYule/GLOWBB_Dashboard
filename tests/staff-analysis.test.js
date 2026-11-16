import test from 'node:test';
import assert from 'node:assert/strict';
import {staffAnalysisSettings,staffAnalysisState} from '../server/staff-analysis.js';
import {participationPatterns} from '../server/patterns.js';
import {eventTypeReport} from '../server/event-report.js';
import {locationFixture} from './fixtures/location-state.js';
import {createApp} from '../server/app.js';
import {openDb} from '../server/db.js';
import {defaults} from '../server/domain.js';
test('engagement threshold settings validate, persist and preserve existing inactivity rules and legacy saves',async()=>{
 const db=openDb(':memory:'),server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const save=body=>fetch(base+'/api/settings',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{for(const engagement of [null,[],{regularFrom:2},{regularFrom:1001},{regularFrom:6.5},{regularFrom:'6'},{regularFrom:6,extra:true}])assert.equal((await save({...defaults,engagement})).status,400);
 assert.equal((await save({...defaults,engagement:{regularFrom:8}})).status,200);
 const {engagement:_ignored,...legacy}=defaults;void _ignored;assert.equal((await save(legacy)).status,200);
 const stored=JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);assert.equal(stored.engagement.regularFrom,8);assert.deepEqual(stored.inactivityBands,[30,60,90]);assert.equal(stored.staffAnalysisFull,undefined);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
});
test('reliability settings validate both thresholds, retain legacy saves and preserve staff visibility policy', async () => {
 const db=openDb(':memory:'), app=createApp(db), server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const save=body=>fetch(base+'/api/settings',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  for(const reliability of [null,{cautionMinimum:20,comparisonFloor:21},{cautionMinimum:1,comparisonFloor:1},{cautionMinimum:20,comparisonFloor:0},{cautionMinimum:20.5,comparisonFloor:10},{cautionMinimum:20,comparisonFloor:10,extra:true}]) assert.equal((await save({...defaults,reliability})).status,400);
  const response=await save({...defaults,reliability:{cautionMinimum:30,comparisonFloor:12}}); assert.equal(response.status,200); assert.equal((await response.json()).reliability.comparisonFloor,12);
  const {reliability:_omitted,...legacy}=defaults;void _omitted;assert.equal((await save(legacy)).status,200);
  const stored=JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);
  assert.deepEqual(stored.reliability,{cautionMinimum:30,comparisonFloor:12});assert.equal(stored.privacyMinimum,5);assert.equal(stored.staffAnalysisFull,undefined);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
});
function fixture(){const s=locationFixture();s.data.participants.forEach((p,i)=>{p.riskRaw=i===0?'>1':i<3?'1':'0';s.registry[i].details=JSON.stringify(p);});for(const session of s.data.sessions)session.optional={eventTypes:['Learning'],eventTypeRaw:'Learning'};return s;}
test('staff analysis releases single-person groups, related totals, repeats and combined slices without inventing registry rates',()=>{
 for(const role of ['admin','planner']){const original=fixture(),state=staffAnalysisState(original,{role});assert.equal(original.settings.privacyMinimum,5);const r=participationPatterns(state,{dimension:'risk',scope:'overall',from:'2026-11-01',to:'2026-11-02'});const one=r.groups.find(g=>g.label==='>1');assert.equal(one.suppressed,false);assert.equal(one.unique,1);assert.equal(one.attendance,2);assert.equal(one.averageSessions,2);assert.equal(one.repeat,1);assert.equal(one.registered,null);assert.equal(one.rate,null);assert.equal(r.rankings.suppressed,false);const combined=participationPatterns(state,{dimension:'risk',scope:'clients',second:'age'});assert.equal(combined.combined.suppressed,false);assert.equal(combined.groups.find(g=>g.label==='>1').registered,1);const event=eventTypeReport(state,{scope:'clients',factor:'risk',group:'>1',target:'all'});assert.equal(event.types[0].unique,1);assert.equal(event.types[0].suppressed,false);assert.equal(event.registered,1);assert.equal(event.types[0].repeat,1);}
});
test('staff visibility is a request projection and cannot grant viewer access or change stored thresholds',()=>{const settings={privacyMinimum:5};assert.equal(staffAnalysisSettings(settings,{role:'viewer'}),settings);assert.equal(staffAnalysisSettings(settings,undefined),settings);assert.equal(settings.staffAnalysisFull,undefined);assert.equal(staffAnalysisSettings(settings,{role:'planner'}).privacyMinimum,0);});
test('staff report API returns every recorded small risk group and entries, while missing registry denominators stay unavailable',async()=>{
 const db=openDb(':memory:'),app=createApp(db);const state=fixture();for(const p of state.data.participants)db.prepare('INSERT INTO participants VALUES(?,?)').run(p.id,JSON.stringify(p));for(const p of state.data.programmes)db.prepare('INSERT INTO programmes(id,name,domain) VALUES(?,?,?)').run(p.id,p.name,p.domain);for(const s of state.data.sessions)db.prepare('INSERT INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)').run(s.id,s.programmeId,s.date,540,600);state.data.attendance.forEach((a,i)=>db.prepare('INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)').run(String(i),a.participantId,a.sessionId,'Synthetic session'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;try{const response=await fetch(base+'/api/participation-patterns?scope=overall&dimension=risk');assert.equal(response.status,200);const r=await response.json(),one=r.groups.find(g=>g.label==='>1');assert.equal(r.minimum,0);assert.equal(one.unique,1);assert.equal(one.attendance,3);assert.equal(one.rate,null);assert.equal(one.registered,null);assert.equal(r.groups.some(g=>g.suppressed),false);assert.equal(JSON.stringify(r).includes('memberId'),false);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
});
