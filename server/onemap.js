import { buildingInput, validCoordinates } from "./location-model.js";
const base = "https://www.onemap.gov.sg";
const fail = (message, status = 503) =>
  Object.assign(Error(message), { status });
export function createOneMap({
  fetchImpl = fetch,
  token = process.env.ONEMAP_TOKEN,
  email = process.env.ONEMAP_EMAIL,
  password = process.env.ONEMAP_PASSWORD,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  let cachedToken = "",
    expires = 0,
    authenticating,
    nextRequest = 0,
    cooldownUntil = 0;
  const configured = () => Boolean(token || (email && password));
  async function access(force = false) {
    if (token && !force) return token;
    if (cachedToken && expires > now() + 60000 && !force) return cachedToken;
    if (!email || !password)
      throw fail(
        "OneMap is not configured or its token needs renewal. Manual verification and straight-line analysis remain available.",
      );
    authenticating ||= (async () => {
      const r = await fetchImpl(base + "/api/auth/post/getToken", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(6000),
        redirect: "error",
      });
      const data = await r.json();
      if (
        !r.ok ||
        !data.access_token ||
        !Number.isFinite(Number(data.expiry_timestamp))
      )
        throw fail(
          "OneMap authentication failed. Check the server-only credentials.",
          503,
        );
      cachedToken = data.access_token;
      expires = Number(data.expiry_timestamp) * 1000;
      return cachedToken;
    })().finally(() => {
      authenticating = null;
    });
    return authenticating;
  }
  async function request(url) {
    if (now() < cooldownUntil)
      throw fail(
        "OneMap is cooling down after a rate limit. Try later; existing verified data is retained.",
        429,
      );
    if (!configured())
      throw fail(
        "OneMap is not configured. Add server-only OneMap credentials or verify coordinates manually.",
      );
    let auth = await access();
    for (let attempt = 0; attempt < 2; attempt++) {
      const delay = Math.max(0, nextRequest - now());
      nextRequest = Math.max(nextRequest, now()) + 300;
      if (delay) await sleep(delay);
      let r, data;
      try {
        r = await fetchImpl(url, {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(6000),
          redirect: "error",
        });
        data = await r.json();
      } catch {
        throw fail(
          "OneMap is unavailable or timed out. Existing verified data remains available.",
        );
      }
      const authError =
        [401, 403].includes(r.status) ||
        /token|authentication/i.test(String(data.error || ""));
      if (authError && attempt === 0 && email && password) {
        auth = await access(true);
        continue;
      }
      if (authError)
        throw fail(
          "OneMap authentication failed or expired. Renew the server-side token.",
        );
      if ((r.status === 429 || r.status >= 500) && !attempt) {
        const suggested = Number(r.headers.get("retry-after") || 0) * 1000;
        if (suggested > 1000) {
          if (r.status === 429) cooldownUntil = now() + suggested;
          throw fail(
            r.status === 429
              ? "OneMap rate limit reached. Wait before refreshing remaining buildings."
              : "OneMap is unavailable or timed out. Try later.",
            r.status === 429 ? 429 : 503,
          );
        }
        const retry = Math.min(
          1000,
          Math.max(300, Number(r.headers.get("retry-after") || 0) * 1000),
        );
        await sleep(retry);
        continue;
      }
      if (r.status === 429)
        throw fail(
          "OneMap rate limit reached. Wait before refreshing the remaining buildings.",
          429,
        );
      if (!r.ok || data.error)
        throw fail(
          "OneMap could not complete this building request. Verify the address or try later.",
        );
      return data;
    }
    throw fail("OneMap request could not be completed.");
  }
  return {
    configured,
    async search(input) {
      const a = buildingInput(input),
        query = a.postal || [a.block, a.street].join(" ");
      const url = new URL("/api/common/elastic/search", base);
      url.search = new URLSearchParams({
        searchVal: query,
        returnGeom: "Y",
        getAddrDetails: "Y",
        pageNum: "1",
      });
      const data = await request(url);
      const results = Array.isArray(data.results) ? data.results : [];
      const candidates = results
        .filter(
          (r) =>
            (!a.postal || r.POSTAL === a.postal) &&
            (!a.block ||
              String(r.BLK_NO).toUpperCase() === a.block.toUpperCase()),
        )
        .map((r) => ({
          block: String(r.BLK_NO || ""),
          street: String(r.ROAD_NAME || ""),
          postal: /^\d{6}$/.test(r.POSTAL || "") ? r.POSTAL : "",
          address: String(r.ADDRESS || ""),
          lat: Number(r.LATITUDE),
          lon: Number(r.LONGITUDE),
          source: "Singapore OneMap; candidate requires staff review",
        }))
        .filter(validCoordinates)
        .slice(0, 20);
      return {
        status:
          Number(data.totalNumPages) > 1 || candidates.length > 1
            ? "Ambiguous"
            : candidates.length
              ? "Awaiting verification"
              : "Unable to locate",
        candidates,
        source: "Singapore OneMap",
        checkedAt: new Date(now()).toISOString(),
      };
    },
    async walk(building, target) {
      if (!validCoordinates(building) || !validCoordinates(target))
        throw fail("Verified coordinates are required before routing.", 400);
      const url = new URL("/api/public/routingsvc/route", base);
      url.search = new URLSearchParams({
        start: `${building.lat},${building.lon}`,
        end: `${target.lat},${target.lon}`,
        routeType: "walk",
      });
      const data = await request(url),
        m = data.route_summary?.total_distance,
        seconds = data.route_summary?.total_time;
      if (
        data.status !== 0 ||
        typeof m !== "number" ||
        !Number.isFinite(m) ||
        m < 0 ||
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < 0 ||
        (m > 0 && seconds === 0)
      )
        throw fail(
          "No valid walking route was returned. Straight-line distance is a separate measure.",
        );
      return {
        walkingM: m,
        timeSeconds: seconds,
        source: "Singapore OneMap walking routing",
        status: "Walking route available",
        calculatedAt: new Date(now()).toISOString(),
      };
    },
  };
}
