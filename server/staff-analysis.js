// Explicit staff analysis policy. Never persist this projection into settings.
// Public/viewer data and endpoint permissions retain their existing contracts.
export function staffAnalysisSettings(settings,user) {
  return ['admin','planner'].includes(user?.role)
    ? {...settings,staffAnalysisFull:true,privacyMinimum:0}
    : settings;
}
export function staffAnalysisState(state,user) {
  return {...state,settings:staffAnalysisSettings(state.settings,user)};
}
