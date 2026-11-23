import test from 'node:test';
import assert from 'node:assert/strict';
import {STAFF_PAGES,staffPage} from '../shared/staff-workspace.js';

test('staff workspace exposes six distinct analytical functions',()=>{
 assert.deepEqual(STAFF_PAGES.map(p=>p.label),['Overview','Programme Analysis','Participation Insights','Client Engagement','Participant Needs','SPPB Assessments']);
 assert.equal(new Set(STAFF_PAGES.map(p=>p.id)).size,6);
 for(const page of STAFF_PAGES)assert.equal(staffPage(page.id,'admin'),page.id);
});
test('old specialist entry points lead to a retained staff workflow',()=>{
 for(const page of ['Planning & Recommendations','Programme Planning and Actions','Audience & Outreach','Custom Analysis','Social Risk Analysis','Who Are We Serving?','Gaps and Participation Barriers','Programme Alignment','Operations & Screening'])assert.ok(STAFF_PAGES.some(p=>p.id===staffPage(page,'planner')),page);
 assert.equal(staffPage('Custom Analysis','planner'),'Participation Patterns & Insights');
 assert.equal(staffPage('Programme Alignment','planner'),'Participant Needs & Accessibility');
 assert.equal(staffPage('Data Quality and Administration','admin'),'Data management');
 assert.equal(staffPage('unknown'),'Overview');
});
test('simplified navigation preserves role restrictions and administrator-only data tools',()=>{
 for(const page of STAFF_PAGES.filter(p=>p.staffOnly))assert.equal(staffPage(page.id,'viewer'),'Overview');
 assert.equal(staffPage('Programme Performance','viewer'),'Programme Performance');
 assert.equal(staffPage('Data management','viewer'),'Overview');
 assert.equal(staffPage('Data management','planner'),'Overview');
 assert.equal(staffPage('Data management','admin'),'Data management');
});
