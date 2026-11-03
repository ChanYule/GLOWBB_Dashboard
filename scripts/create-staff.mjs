// Read one JSON object from stdin; passwords never appear in command arguments.
import { openDb, passwordHash } from "../server/db.js";
import { openPostgres } from "../server/postgres.js";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { username, password, role = "admin" } = JSON.parse(input);
if (
  !/^[a-zA-Z0-9._-]{3,60}$/.test(username) ||
  username === "__local_workspace__" ||
  typeof password !== "string" ||
  password.length < 12 ||
  password.length > 200 ||
  !["admin", "planner", "viewer"].includes(role)
)
  throw Error(
    "Use a valid username, a 12–200 character password and a valid role.",
  );
const db = process.env.DATABASE_URL
  ? openPostgres(process.env.DATABASE_URL)
  : openDb();
try {
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
  console.log("Staff account saved. Existing sessions revoked.");
} finally {
  await db.close();
}
