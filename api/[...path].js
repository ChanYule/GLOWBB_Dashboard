import { Readable } from "node:stream";

const methods = new Set(["GET", "HEAD", "POST", "PUT", "DELETE"]);
const maxBody = 4 * 1024 * 1024;
function json(res, status, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ error: message }));
}

export function createProxy({ backendUrl, fetchImpl = fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (!backendUrl)
      return json(
        res,
        503,
        "The dashboard backend is not connected yet. Configure DASHBOARD_BACKEND_URL in Vercel and redeploy.",
      );
    let base;
    try {
      base = new URL(backendUrl);
      if (
        base.protocol !== "https:" ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== "/"
      )
        throw Error();
    } catch {
      return json(
        res,
        503,
        "The dashboard backend address is not configured correctly.",
      );
    }
    const incoming = new URL(req.url, "https://dashboard.invalid");
    if (!incoming.pathname.startsWith("/api/"))
      return json(res, 404, "Endpoint not found.");
    if (!methods.has(req.method)) return json(res, 405, "Method not allowed.");
    const target = new URL(incoming.pathname + incoming.search, base);
    if (target.origin !== base.origin || !target.pathname.startsWith("/api/"))
      return json(res, 400, "Invalid API path.");
    const headers = new Headers();
    for (const key of ["content-type", "accept", "origin"])
      if (req.headers[key]) headers.set(key, req.headers[key]);
    let body;
    if (!["GET", "HEAD"].includes(req.method)) {
      try {
        // Vercel parses JSON/text lazily; multipart remains an incoming stream.
        const parsed = req.body;
        if (parsed !== undefined)
          body = Buffer.isBuffer(parsed)
            ? parsed
            : Buffer.from(
                typeof parsed === "string" ? parsed : JSON.stringify(parsed),
              );
        else {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            const buffer = Buffer.from(chunk);
            size += buffer.length;
            if (size > maxBody)
              return json(
                res,
                413,
                "This hosted upload is too large. Use a file smaller than 4 MB.",
              );
            chunks.push(buffer);
          }
          body = Buffer.concat(chunks);
        }
        if (body.length > maxBody)
          return json(
            res,
            413,
            "This hosted upload is too large. Use a file smaller than 4 MB.",
          );
      } catch {
        return json(res, 400, "The request body could not be read.");
      }
    }
    try {
      const upstream = await fetchImpl(target, {
        method: req.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(55000),
      });
      const type = upstream.headers.get("content-type") || "";
      const report = incoming.pathname === "/api/export/report";
      const csv = incoming.pathname === "/api/export/csv";
      if (upstream.status >= 300 && upstream.status < 400)
        return json(
          res,
          502,
          "The dashboard backend redirected unexpectedly. Check its configured address.",
        );
      if (
        !type.includes("application/json") &&
        !(report && type.includes("text/html")) &&
        !(csv && type.includes("text/csv"))
      )
        return json(
          res,
          502,
          "The dashboard backend returned an unexpected response. Check that the full server is running.",
        );
      res.statusCode = upstream.status;
      for (const key of [
        "content-type",
        "content-disposition",
        "content-security-policy",
        "x-content-type-options",
        "x-frame-options",
      ]) {
        const value = upstream.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      if (req.method === "HEAD" || !upstream.body) return res.end();
      await new Promise((resolve, reject) => {
        const stream = Readable.fromWeb(upstream.body);
        stream.on("error", reject);
        res.on("finish", resolve);
        res.on("error", reject);
        stream.pipe(res);
      });
    } catch {
      if (!res.headersSent)
        json(
          res,
          502,
          "The dashboard backend is unavailable. Please try again shortly.",
        );
      else res.end();
    }
  };
}

export default function handler(req, res) {
  return createProxy({ backendUrl: process.env.DASHBOARD_BACKEND_URL })(
    req,
    res,
  );
}
