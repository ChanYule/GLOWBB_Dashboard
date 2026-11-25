import test from "node:test";
import assert from "node:assert/strict";
import {centreQaFixture} from "../scripts/centre-qa-fixture.mjs";
import {tsImport} from "tsx/esm/api";

test("relative meeting periods use completed calendar boundaries",async()=>{
  const {meetingPeriod}=await tsImport("../src/meeting-layouts.tsx",import.meta.url);
  assert.deepEqual(meetingPeriod("month",{},"2024-03-01"),{from:"2024-02-01",to:"2024-02-29"});
  assert.deepEqual(meetingPeriod("quarter",{},"2026-01-10"),{from:"2025-10-01",to:"2025-12-31"});
});
test("meeting endpoint allows only SEEN Nanyang and returns one aggregate package",async()=>{
  const fixture=await centreQaFixture();
  const server=fixture.app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const url="http://127.0.0.1:"+server.address().port+"/api/reporting/meeting?centre=";
  try{
    const db=await fixture.app.platform.workspaces.get("seen_nanyang");
    db.prepare("INSERT INTO programmes(id,name,domain) VALUES(?,?,?)").run("test-programme","Movement","Physical");
    db.prepare("INSERT INTO sessions(id,programme_id,date,start,end) VALUES(?,?,?,?,?)").run("test-session","test-programme","2026-01-02",540,600);
    for(let i=0;i<6;i++){
      db.prepare("INSERT INTO participants VALUES(?,?)").run("synthetic-member-"+i,JSON.stringify({age:70,race:"CHINESE",gender:"FEMALE"}));
      db.prepare("INSERT INTO attendance(id,participant_id,session_id,source_session) VALUES(?,?,?,?)").run("test-attendance-"+i,"synthetic-member-"+i,"test-session","synthetic");
    }
    for(const centre of ["glow_nanyang","glow_bukit_batok","seen_bukit_batok"]) assert.equal((await fetch(url+centre)).status,403);
    const response=await fetch(url+"seen_nanyang&from=2026-01-01&to=2026-01-31");
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.overview.summary.unique,6);
    assert.equal(result.domains.total.unique,6);
    assert.equal(result.overview.metadata.reporting.version,1);
    assert.equal(JSON.stringify(result).includes("synthetic-member"),false);
    assert.ok(result.briefing);
  }finally{await new Promise(resolve=>server.close(resolve));await fixture.close();}
});
