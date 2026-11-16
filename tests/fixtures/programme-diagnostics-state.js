import { locationFixture } from "./location-state.js";
export function diagnosticFixture() {
  const s = locationFixture();
  s.settings.staffAnalysisFull = true;
  s.data.attendance = [];
  s.data.programmes = [
    { id: "a", name: "Repeated movement", domain: "Physical" },
    { id: "b", name: "One-session learning", domain: "Learning" },
    { id: "c", name: "Small social", domain: "Social" },
    { id: "d", name: "No repeat movement", domain: "Physical" },
  ];
  s.data.sessions = [
    { id: "a1", programmeId: "a", date: "2026-11-01" },
    { id: "a2", programmeId: "a", date: "2026-11-02" },
    { id: "b1", programmeId: "b", date: "2026-11-03" },
    { id: "c1", programmeId: "c", date: "2026-11-03" },
    { id: "d1", programmeId: "d", date: "2026-11-01" },
    { id: "d2", programmeId: "d", date: "2026-11-02" },
  ];
  s.data.participants.forEach((p, i) => {
    p.age = i < 20 ? 65 : 75;
    s.registry[i].details = JSON.stringify(p);
    const ids =
      i < 10
        ? ["a1", "a2", "b1", i < 5 ? "d1" : "d2", ...(i === 0 ? ["c1"] : [])]
        : i < 20
          ? ["b1"]
          : i < 80
            ? ["a1"]
            : [];
    ids.forEach((sessionId) =>
      s.data.attendance.push({ participantId: p.id, sessionId }),
    );
  });
  return s;
}
