import test from 'node:test';
import assert from 'node:assert/strict';
import {needsAnalysis} from '../server/needs-domain.js';
const now='2026-11-06';
function fixture(){
 const participants=[
  {id:'client-attendee',age:75,cfs:'4',client:true},
  {id:'non-client-under-60',age:55,cfs:'6',client:false},
  {id:'unknown-cfs',age:null,cfs:null,client:false},
  {id:'registered-nonattender',age:85,cfs:'7-8',client:true},
  {id:'earlier-only',age:70,cfs:'5',client:false},
  {id:'future-only',age:70,cfs:'5',client:false},
 ].map(p=>({...p,gender:'MALE',race:'CHINESE',livingRaw:'Alone'}));
 const sessions=[{id:'s1',programmeId:'A',date:'2026-11-01',start:540,end:600},{id:'s2',programmeId:'B',date:'2026-11-02',start:540,end:600},{id:'old',programmeId:'A',date:'2026-10-01',start:540,end:600},{id:'future',programmeId:'A',date:'2026-11-07',start:540,end:600}];
 const attendance=[['client-attendee','s1'],['non-client-under-60','s1'],['non-client-under-60','s2'],['non-client-under-60','s1'],['unknown-cfs','s1'],['earlier-only','old'],['future-only','future']].map(([participantId,sessionId],i)=>({id:String(i),participantId,sessionId}));
 const registry=participants.filter(p=>p.client).map(p=>({participant_id:p.id,snapshot:'test-registry',details:JSON.stringify(p)}));
 return {data:{participants,sessions,attendance,programmes:[{id:'A',name:'Programme A',domain:'Physical',optional:{}},{id:'B',name:'Programme B',domain:'Social',optional:{}}]},registry,settings:{staffAnalysisFull:true,privacyMinimum:0,registry:{complete:true,snapshot:'test-registry',type:'clients',asOf:'2026-11-01'}}};
}
function report(f,filters={from:'2026-11-01',to:'2026-11-02'}){return needsAnalysis(f.data,[],[],f.registry,f.settings,filters,now);}
test('CFS cohort uses distinct attendees across all ages and client statuses, not the complete registry',()=>{const r=report(fixture()),cfs=r.profiles.cfs;assert.equal(cfs.denominator,3);assert.equal(cfs.population,'attendance');assert.equal(cfs.values.reduce((n,v)=>n+v.unique,0),3);assert.deepEqual(Object.fromEntries(cfs.values.map(v=>[v.label,v.unique])),{'4':1,'6':1,Missing:1});assert.equal(cfs.values.some(v=>v.label==='7-8'),false);assert.match(cfs.note,/selected reporting period/);assert.equal(r.profiles.living.denominator,2,'other registry profile scopes are unchanged');const nonclient=cfs.values.find(v=>v.label==='6');assert.equal(nonclient.attendance,2);assert.equal(nonclient.frequency,2);assert.equal(nonclient.repeat,1);});
test('CFS cohort follows reporting dates and programme filters; empty and unknown records remain explicit',()=>{const f=fixture();const day=report(f,{from:'2026-11-02',to:'2026-11-02'}).profiles.cfs;assert.equal(day.denominator,1);assert.equal(day.values[0].label,'6');assert.equal(day.values[0].unique,1);const programme=report(f,{programme:'B'}).profiles.cfs;assert.equal(programme.denominator,1);assert.equal(programme.values[0].attendance,1);const empty=report(f,{from:'2026-09-01',to:'2026-09-30'}).profiles.cfs;assert.equal(empty.denominator,0);assert.deepEqual(empty.values,[]);});
test('adding registered nonattenders cannot inflate CFS participant counts or percentages',()=>{const f=fixture(),before=report(f).profiles.cfs;for(let i=0;i<100;i++){const p={id:'extra-'+i,client:true,age:80,cfs:'7-8'};f.data.participants.push(p);f.registry.push({participant_id:p.id,snapshot:'test-registry',details:JSON.stringify(p)});}assert.deepEqual(report(f).profiles.cfs,before);});
