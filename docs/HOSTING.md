# Hosting the Vercel dashboard with persistent data

The deployed homepage at `https://glowbbdashboard.vercel.app/` was serving only the Vite build. Its `/api/dashboard` and `/api/quality` paths returned HTTP 404 with plain text `The page could not be found`, which triggered the JSON error in the screenshot.

This repository includes two parts:

- **Vercel:** the existing frontend plus `api/[...path].js`, a same-origin API forwarder. It reads `DASHBOARD_BACKEND_URL` from a server-side environment variable.
- **Persistent server:** the existing Express/SQLite application, deployed as a single service with a persistent disk. `render.yaml` is an optional ready-to-review Render Blueprint for that service.

A local SQLite file is not durable storage inside Vercel Functions. Do not point the database at `/tmp` or use a per-function empty database: data would disappear or differ across instances. [Vercel’s SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel) explains this limitation.

## 1. Create the persistent server

The prepared Render Blueprint uses a **paid Starter service and a 1 GB persistent disk**. Review provider pricing and resource settings before creating it; writing this file has not created or billed any resource. You may instead run the same Node application on another server with a persistent volume.

For Render, connect this repository and create a Blueprint using `render.yaml`. It specifies:

| Setting                 | Value                                           |
| ----------------------- | ----------------------------------------------- |
| Build                   | `npm ci && npm run build`                       |
| Start                   | `npm start`                                     |
| Node                    | 24.19.0                                         |
| Instances               | 1                                               |
| Bind address            | `HOST=0.0.0.0`                                  |
| Database                | `DB_PATH=/var/data/glowbb.sqlite`               |
| Disk mount              | `/var/data`                                     |
| Allowed mutation origin | `APP_ORIGIN=https://glowbbdashboard.vercel.app` |
| Health check            | `/api/ready`                                    |

Only the mounted disk path persists. Keep one service instance: import previews are held in that server's memory and SQLite is a single-file store. Do not use Render's free ephemeral filesystem for attendance data. See [Render persistent disks](https://render.com/docs/disks).

Wait for the service to deploy, then check `https://YOUR-SERVICE.onrender.com/api/ready`: it must return JSON with `ready: true` and `schemaVersion: 1`. Copy the service origin. No passwords or tokens are needed in this URL.

For an existing local database, transfer a consistent backup to the mounted disk with the service stopped before importing further data. Do not overwrite an existing remote database. If no attendance has been imported yet, startup creates an empty persistent database.

## 2. Connect Vercel

1. Deploy this repository's updated source to the existing Vercel project. `vercel.json` keeps the Vite build in `dist` and includes the API function.
2. In the Vercel project's **Environment Variables**, create `DASHBOARD_BACKEND_URL` with the server origin, e.g. `https://YOUR-SERVICE.onrender.com`. This must be HTTPS, with no path, credentials or query string. Do not prefix it with `VITE_`; it is used on the server.
3. Redeploy Vercel so the function receives the environment variable.
4. Open `https://glowbbdashboard.vercel.app/api/ready`. It should return the persistent server's readiness JSON.
5. Reload the dashboard. Import preview, confirmation, targets, planning and reports should now use the same persistent database.

The Vercel proxy supports JSON mutations, raw multipart uploads, CSV downloads and HTML print reports. It forwards the original browser origin, so the backend must use the correct `APP_ORIGIN`. Preview domains need their own isolated backend or matching origin configuration; the supplied Blueprint targets the production domain above.

Vercel has its own request limits. The proxy limits incoming bodies to 4 MB to leave room below the platform limit; keep attendance uploads smaller than 4 MB when using the hosted Vercel frontend. Local direct imports retain the existing 8 MB limit. Split larger exports into smaller files; repeat imports remain idempotent. The proxy never stores uploads or attendance in a function's filesystem.

## 3. Verify persistence and normal use

Import a small non-sensitive test file, confirm it, and verify calculated metrics. Reimport it and confirm it adds no duplicate attendance. Restart the persistent server, reload the dashboard and confirm the same data remains. Then check exports and planning decisions. Readiness alone does not verify disk persistence across deployment; perform this restart check before real attendance use.

Login remains removed as requested. Anyone able to reach these URLs can view or change the workspace; the server has no per-person authentication. Same-origin mutation checks and report privacy restrictions remain, but are not authentication.

If the backend is missing or down, requests now return a clear JSON setup/unavailable error. The client also handles plain-text/HTML responses and invalid JSON without showing a raw parser exception. These changes do not invent empty statistics to hide a failed server connection.

## Current delivery status

Code and configuration are prepared locally. No Render backend has been created and no Vercel environment variable or deployment has been changed in this task. The existing hosted page will continue to fail until the persistent service is deployed and connected. Use the Vercel and Render integrations to complete account-side deployment, or follow the settings above in their dashboards.
