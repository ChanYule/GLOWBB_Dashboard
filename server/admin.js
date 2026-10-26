import { openDb, passwordHash, audit } from "./db.js";
const username = process.env.STAFF_USERNAME,
  password = process.env.STAFF_PASSWORD,
  role = process.env.STAFF_ROLE || "admin";
if (
  !username ||
  !password ||
  password.length < 12 ||
  !["admin", "planner", "viewer"].includes(role)
) {
  console.error(
    "Set STAFF_USERNAME, STAFF_PASSWORD (at least 12 characters), and optional STAFF_ROLE (admin/planner/viewer).",
  );
  process.exit(1);
}
const db = openDb();
const result = db
  .prepare(
    "INSERT INTO users(username,password,role) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET password=excluded.password,role=excluded.role RETURNING id",
  )
  .get(username, passwordHash(password), role);
db.prepare("DELETE FROM logins WHERE user_id=?").run(result.id);
audit(db, result.id, "staff.account-configured", { role });
db.close();
console.log("Staff account configured; previous sessions revoked.");
