import { defaults } from "../../server/domain.js";
import { CLIENT_SNAPSHOT } from "../../server/client-domain.js";
import {
  locationDefaults,
  addressKey,
  buildingAddressKey,
  routeKey,
  refreshStraightCache,
} from "../../server/location-model.js";
export function locationFixture() {
  const locations = locationDefaults();
  locations.centre = {
    ...locations.centre,
    lat: 1.35,
    lon: 103.75,
    status: "Verified",
    source: "Synthetic test coordinates; not the actual centre",
  };
  const state = {
    locations,
    settings: {
      ...defaults,
      registry: {
        type: "clients",
        complete: true,
        snapshot: CLIENT_SNAPSHOT,
        asOf: "2026-11-01",
      },
    },
    registry: [],
    profiles: [],
    feedback: [],
    data: {
      participants: [],
      programmes: [
        {
          id: "a",
          name: "Repeated programme",
          domain: "Physical",
          optional: {},
        },
        { id: "b", name: "Off-site programme", domain: "Social", optional: {} },
      ],
      sessions: [
        {
          id: "s1",
          programmeId: "a",
          date: "2026-11-01",
          start: 540,
          venue: "Recorded venue A",
        },
        {
          id: "s2",
          programmeId: "a",
          date: "2026-11-02",
          start: 540,
          venue: "Recorded venue A",
        },
        {
          id: "s3",
          programmeId: "b",
          date: "2026-11-03",
          start: 840,
          venue: "Recorded venue B",
        },
      ],
      attendance: [],
    },
  };
  for (let band = 0; band < 5; band++) {
    const building = {
      id: "building-" + band,
      block: band < 2 ? "212" : String(210 + band),
      street: "Synthetic street " + band,
      postal: "65010" + band,
      address: `Synthetic building ${band}`,
      lat: 1.35 + band * 0.001,
      lon: 103.75,
      status: band < 4 ? "Verified" : "Ambiguous",
      source: "Synthetic review",
    };
    locations.buildings[building.id] = building;
    for (let i = 0; i < 20; i++) {
      const p = {
        id: `client-${band}-${i}`,
        memberId: `MEMBER-${band}-${i}`,
        blockRaw: building.block,
        age: 65,
        gender: "MALE",
        race: "CHINESE",
        livingRaw: "Alone",
        cfs: "4",
        riskRaw: "0",
        client: true,
      };
      state.data.participants.push(p);
      state.registry.push({
        participant_id: p.id,
        snapshot: CLIENT_SNAPSHOT,
        details: JSON.stringify(p),
      });
      locations.bindings[p.id] = {
        buildingId: building.id,
        sourceKey: addressKey(p),
        buildingAddressKey: buildingAddressKey(building),
      };
      if (i < 10)
        for (const sessionId of ["s1", "s2", "s3"])
          state.data.attendance.push({ participantId: p.id, sessionId });
    }
  }
  refreshStraightCache(locations);
  for (let band = 0; band < 4; band++) {
    const building = locations.buildings["building-" + band];
    locations.routes[routeKey(building, locations.centre)] = {
      buildingId: building.id,
      targetId: "centre",
      walkingM: [500, 1000, 2000, 2200][band],
      timeSeconds: [300, 600, 1200, 1500][band],
      straightM: band * 111,
      source: "Synthetic route fixture",
      status: "Walking route available",
      calculatedAt: new Date().toISOString(),
    };
  }
  return state;
}
