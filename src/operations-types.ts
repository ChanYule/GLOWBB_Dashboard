export type OperationalRow = {
  label?: string;
  from: string;
  to: string;
  programmes: number;
  sessions: number;
  attendance: number;
  unique: number;
  average: number;
  ib: number;
  ob: number;
  unknownClient: number;
  ibPct: number | null;
  obPct: number | null;
  male: number;
  malePct: number | null;
  unknownGender: number;
  missingAge: number;
  firstObserved: number;
  returning: number;
  newIb: number;
  newOb: number;
  repeatRate: number | null;
  inactive: number | null;
  newlyInactive: number | null;
  reactivated: number | null;
  sppb: number | null;
  tanita: number | null;
  sppbPeople?: number;
  tanitaPeople?: number;
  final?: boolean;
  fullySelected?: boolean;
};
export type MonthlyAssessment = {
  month: string;
  type: "SPPB" | "TANITA";
  total: number;
  reported_as_of: string;
  complete: number;
  created?: string;
};
export type OperationalTarget = {
  id: string;
  month: string;
  metric: string;
  label: string;
  value: number;
  actual: number | null;
  progress: number | null;
  remaining: number | null;
};
export type OperationsReport = {
  activityScreening: {
    activityNames: { sppb: string; tanita: string };
    sppb: { people: number; attendance: number };
    tanita: { people: number; attendance: number };
    daily: { label: string; sppbPeople: number; tanitaPeople: number }[];
    monthly: { label: string; sppbPeople: number; tanitaPeople: number }[];
  };
  period: { from: string; to: string; now: string };
  summary: OperationalRow;
  rows: OperationalRow[];
  monthly: OperationalRow[];
  settings: { inactivityDays: number | null };
  health: {
    source: string;
    unsegmented: boolean;
    sppb: {
      total: number | null;
      reportedMonths: number;
      thisMonth: number | null;
    };
    tanita: {
      total: number | null;
      reportedMonths: number;
      thisMonth: number | null;
    };
    selectedMonths: number;
    history: MonthlyAssessment[];
    revisions: number;
    revisionHistory: MonthlyAssessment[];
  };
  attention: { title: string; value: number; detail: string; view: string }[];
  insights: { title: string; detail: string; action: string; view: string }[];
  targets: OperationalTarget[];
  definitions: { inactivity: string };
};
export type AssessmentPreview = {
  id: string;
  rows: MonthlyAssessment[];
  warnings: { row: number; message: string }[];
  message: string;
};
