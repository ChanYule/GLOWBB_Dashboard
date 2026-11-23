// A small staff workspace, shared by the platform and standalone dashboard.
export const STAFF_PAGES=Object.freeze([
 {id:'Overview',label:'Overview',staffOnly:false},
 {id:'Programme Performance',label:'Programme Analysis',staffOnly:false},
 {id:'Participation Patterns & Insights',label:'Participation Insights',staffOnly:true},
 {id:'Client Engagement',label:'Client Engagement',staffOnly:true},
 {id:'Participant Needs & Accessibility',label:'Participant Needs',staffOnly:true},
 {id:'SPPB Assessments',label:'SPPB Assessments',staffOnly:true},
]);
const aliases={
 'Planning & Recommendations':'Programme Performance',
 'Programme Planning and Actions':'Client Engagement',
 'Audience & Outreach':'Participation Patterns & Insights',
 'Custom Analysis':'Participation Patterns & Insights',
 'Social Risk Analysis':'Participant Needs & Accessibility',
 'Who Are We Serving?':'Participant Needs & Accessibility',
 'Gaps and Participation Barriers':'Participant Needs & Accessibility',
 'Programme Alignment':'Participant Needs & Accessibility',
 'Data Quality and Administration':'Data management',
 'Operations & Screening':'Overview',
};
export function staffPage(page,role='planner'){
 const id=Object.hasOwn(aliases,page)?aliases[page]:page;
 if(id==='Data management')return role==='admin'?id:'Overview';
 const item=STAFF_PAGES.find(p=>p.id===id);
 return item&&(!item.staffOnly||role!=='viewer')?item.id:'Overview';
}
