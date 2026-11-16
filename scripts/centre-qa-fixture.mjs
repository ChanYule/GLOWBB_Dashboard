// Explicit single-centre provenance for isolated QA only. Never opens saved data.
import { openDb } from "../server/db.js";
import { createPlatformApp } from "../server/platform.js";
import { mirrorUser } from "../server/centre-store.js";
export async function centreQaFixture() {
  const control = openDb(":memory:"),
    children = new Map();
  const app = createPlatformApp(control, {
    authRequired: false,
    openWorkspace: (id) => {
      const db = openDb(":memory:");
      children.set(id, db);
      return db;
    },
  });
  await app.platform.ready;
  const db = await app.platform.workspaces.get("glow_bukit_batok");
  const user = control
    .prepare("SELECT * FROM users WHERE username='__local_workspace__'")
    .get();
  await mirrorUser(db, user);
  return {
    app,
    db,
    control,
    async close() {
      for (const db of children.values()) db.close();
      control.close();
    },
  };
}
