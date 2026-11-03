import { randomBytes } from "node:crypto";
import { hash } from "./domain.js";
import { passwordHash, verifyPassword } from "./db.js";

const fail = (status, message) => Object.assign(Error(message), { status });
export function mountIdentity(app, db, { required, production }) {
  const attempts = new Map();
  app.post("/api/login", async (req, res) => {
    const key = req.ip;
    const attempt = attempts.get(key);
    if (attempt && attempt.until > Date.now() && attempt.count >= 10)
      throw fail(429, "Too many attempts. Try again in 15 minutes.");
    if (!attempt || attempt.until < Date.now())
      attempts.set(key, { count: 0, until: Date.now() + 900000 });
    attempts.get(key).count++;
    const { username, password } = req.body || {};
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      password.length > 200
    )
      throw fail(400, "Enter your username and password.");
    const user = await db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(username);
    if (!user || !verifyPassword(password, user.password))
      throw fail(401, "Username or password was not accepted.");
    attempts.delete(key);
    const token = randomBytes(32).toString("hex");
    await db.prepare("DELETE FROM logins WHERE expires < ?").run(Date.now());
    await db
      .prepare("INSERT INTO logins VALUES(?,?,?)")
      .run(hash(token), user.id, Date.now() + 28800000);
    res.set(
      "Set-Cookie",
      `glow_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production ? "; Secure" : ""}`,
    );
    res.json({ username: user.username, role: user.role, id: user.id });
  });
  app.use("/api", async (req, _res, next) => {
    const token = req
      .get("cookie")
      ?.match(/(?:^|;\s*)glow_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    let user;
    if (token)
      user = await db
        .prepare(
          "SELECT users.id,users.username,users.role FROM users JOIN logins ON logins.user_id=users.id WHERE logins.token=? AND logins.expires>?",
        )
        .get(hash(token), Date.now());
    if (!user && !required)
      user = await db
        .prepare("SELECT id,username,role FROM users WHERE username=?")
        .get("__local_workspace__");
    if (!user) throw fail(401, "Sign in with your staff account.");
    req.user = {
      ...user,
      username:
        user.username === "__local_workspace__"
          ? "Local workspace"
          : user.username,
    };
    // Organisation definitions, imports and exports have server-side permission checks.
    const path = req.originalUrl.split("?")[0];
    const adminPath =
      /^\/api\/(settings|risk-configuration|users|import|backups)(?:\/|$)/.test(
        path,
      );
    if (adminPath && req.user.role !== "admin")
      throw fail(403, "Administrator access is required.");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.user.role === "viewer" &&
      !path.startsWith("/api/preferences") &&
      path !== "/api/logout"
    )
      throw fail(403, "This account has read-only access.");
    if (path.startsWith("/api/export") && req.user.role === "viewer")
      throw fail(403, "This account cannot export reports.");
    next();
  });
  app.post("/api/logout", async (req, res) => {
    const token = req.get("cookie")?.match(/glow_session=([a-f0-9]{64})/)?.[1];
    if (token)
      await db.prepare("DELETE FROM logins WHERE token=?").run(hash(token));
    res.set(
      "Set-Cookie",
      "glow_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    res.json({ ok: true });
  });
  app.get("/api/users", async (_req, res) =>
    res.json(
      await db
        .prepare(
          "SELECT id,username,role FROM users WHERE username<>? ORDER BY username",
        )
        .all("__local_workspace__"),
    ),
  );
  app.post("/api/users", async (req, res) => {
    const { username, password, role } = req.body || {};
    if (
      typeof username !== "string" ||
      !/^[a-zA-Z0-9._-]{3,60}$/.test(username) ||
      username === "__local_workspace__" ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 200 ||
      !["admin", "planner", "viewer"].includes(role)
    )
      throw fail(
        400,
        "Use a 3–60 character username and a 12–200 character password, with a valid role.",
      );
    await db
      .prepare(
        "INSERT INTO users(username,password,role) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET password=excluded.password,role=excluded.role",
      )
      .run(username, passwordHash(password), role);
    await db
      .prepare(
        "DELETE FROM logins WHERE user_id=(SELECT id FROM users WHERE username=?)",
      )
      .run(username);
    res.json({ ok: true });
  });
}
