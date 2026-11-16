export type ProgrammeDiagnostic = {
  repeatRate: number | null;
  smallSample: boolean;
  smallReachBelow: number;
  verySmallReachBelow: number;
  oneOffDraw: boolean | null;
  reasons: string[];
  singleSession: boolean;
};
export type Representation = {
  groupAttendees: number;
  programmeAttendees: number;
  groupRegistered: number;
  registered: number;
  attendeeShare: number;
  registeredShare: number;
  differencePoints: number;
  ratio: number | null;
};
export type DomainMix = {
  suppressed: boolean;
  available: boolean;
  unique: number | null;
  attendance: number | null;
  rows: {
    label: string;
    unique: number;
    attendeeShare: number | null;
    attendance: number | null;
    entryShare: number | null;
  }[];
};
export function programmeDiagnostics(
  counts: {
    unique?: number | null;
    repeat?: number | null;
    sessions?: number | null;
  },
  reliability?: { cautionMinimum?: number; comparisonFloor?: number },
): ProgrammeDiagnostic;
export function programmeRepresentation(counts: {
  groupAttendees: number;
  programmeAttendees: number;
  groupRegistered: number;
  registered: number;
}): Representation | null;
