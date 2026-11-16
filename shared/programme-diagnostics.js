import { reliabilityOptions } from "./participation-reliability.js";
const percent = (a, b) => (b > 0 ? (a / b) * 100 : null);
export function programmeDiagnostics(
  { unique, repeat, sessions },
  reliability,
) {
  const config = reliabilityOptions(reliability);
  const validReach = Number.isSafeInteger(unique) && unique >= 0;
  const validRepeat =
    validReach &&
    Number.isSafeInteger(repeat) &&
    repeat >= 0 &&
    repeat <= unique;
  const validSessions = Number.isSafeInteger(sessions) && sessions >= 0;
  const smallSample =
    validReach && unique > 0 && unique < config.cautionMinimum;
  const verySmall = validReach && unique > 0 && unique < config.comparisonFloor;
  const noRepeatAcrossSessions =
    validRepeat && validSessions && unique > 0 && sessions >= 2 && repeat === 0;
  return {
    repeatRate: validRepeat ? percent(repeat, unique) : null,
    smallSample,
    smallReachBelow: config.cautionMinimum,
    verySmallReachBelow: config.comparisonFloor,
    oneOffDraw: verySmall
      ? true
      : validReach && validSessions && validRepeat
        ? noRepeatAcrossSessions
        : null,
    reasons: [
      ...(verySmall
        ? [
            `Very small reach: ${unique} people, below ${config.comparisonFloor}`,
          ]
        : []),
      ...(noRepeatAcrossSessions
        ? [`No repeated attendance across ${sessions} delivered sessions`]
        : []),
    ],
    singleSession: validSessions && sessions === 1,
  };
}

// Same-population comparison only; callers must gate this on complete registry
// and protected total/complement releases before supplying these counts.
export function programmeRepresentation({
  groupAttendees,
  programmeAttendees,
  groupRegistered,
  registered,
}) {
  const counts = [
    groupAttendees,
    programmeAttendees,
    groupRegistered,
    registered,
  ];
  if (
    !counts.every((n) => Number.isSafeInteger(n) && n >= 0) ||
    !programmeAttendees ||
    !registered ||
    groupAttendees > programmeAttendees ||
    groupAttendees > groupRegistered ||
    programmeAttendees > registered ||
    groupRegistered > registered
  )
    return null;
  const attendeeShare = percent(groupAttendees, programmeAttendees),
    registeredShare = percent(groupRegistered, registered);
  return {
    groupAttendees,
    programmeAttendees,
    groupRegistered,
    registered,
    attendeeShare,
    registeredShare,
    differencePoints: attendeeShare - registeredShare,
    ratio: registeredShare > 0 ? attendeeShare / registeredShare : null,
  };
}
