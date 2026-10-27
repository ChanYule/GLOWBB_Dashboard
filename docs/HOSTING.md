# Deploy with Vercel and Supabase

Keep the existing Vercel project (`https://glowbbdashboard.vercel.app`). Vercel hosts the Vite frontend and the Express API through `api/[...path].js`. Supabase PostgreSQL stores attendance, settings, targets, decisions, audit history and import previews. No Render service or persistent disk is needed for this setup.

The code is prepared locally. No Supabase project has been created, no environment variables have been set in Vercel, and no deployment has been performed.

## 1. Create the Supabase project

1. Open the [Supabase dashboard](https://supabase.com/dashboard) and create a project in your organisation.
2. Choose an appropriate region (Singapore is a nearby option if available) and save the database password privately. Review the plan before creating the project.
3. Wait for provisioning to finish.
4. Open **SQL Editor**, create a query, paste the complete contents of [`supabase/migrations/001_dashboard.sql`](../supabase/migrations/001_dashboard.sql), and run it.

The migration creates a private `glowbb` schema and initial settings. It is additive and can be run again without resetting data. It enables row-level security and denies the `anon` and `authenticated` roles access. The browser uses this app's API rather than the Supabase Data API. Keep `glowbb` out of the Data API's exposed schemas. Use a new dedicated project and its default `postgres` database account on the server for this setup.

## 2. Copy the database connection string

In Supabase, click **Connect** and select **Transaction pooler**. Copy the URI shown by your project. It normally has this shape:

```text
postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:6543/postgres
```

Replace the password placeholder with your database password, URL-encoding special characters. Use the exact username and host from the dialog. This is the **database password**, not a publishable, anon or service-role API key.

[Supabase recommends transaction pooling for serverless connections](https://supabase.com/docs/guides/database/connecting-to-postgres). This app uses one PostgreSQL connection per warm function instance, unnamed queries, and a single checked-out connection for each transaction. TLS certificate verification stays enabled. If your connection requires a project root certificate, download it from Supabase's database SSL settings and put the PEM contents in `DATABASE_CA_CERT`. Standard trusted certificate authorities remain supported alongside that certificate.

## 3. Configure the existing Vercel project

Open the existing project in [Vercel](https://vercel.com/dashboard), then **Settings → Environment Variables**. Add these values for **Production**:

| Variable           | Value                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| `DATABASE_URL`     | The complete Supabase Transaction pooler URI, including its database password |
| `APP_ORIGIN`       | `https://glowbbdashboard.vercel.app` (no trailing slash)                      |
| `DATABASE_CA_CERT` | Optional: downloaded PEM root certificate, if required by your connection     |

Keep these names server-side. Do not add a `VITE_` prefix, commit credentials, or paste passwords into chat. No Supabase frontend API keys are required.

Deploy this repository's updated source to the existing Vercel project. Its configuration already specifies:

| Setting          | Value              |
| ---------------- | ------------------ |
| Framework        | Vite               |
| Build command    | `npm run build`    |
| Output directory | `dist`             |
| Node.js          | 24.x               |
| API entry point  | `api/[...path].js` |

For a Git-connected project, push the reviewed changes to its configured production branch. Redeploy after changing environment variables; changing them alone does not update an existing deployment.

`DATABASE_URL` takes precedence over the older `DASHBOARD_BACKEND_URL` proxy setting. Remove the old setting after switching. If no database URL is present, the older proxy remains available when a backend URL is configured. With neither value, the API returns a JSON setup error rather than creating a temporary SQLite database.

Use a separate Supabase project and the exact preview origin for preview deployments. Production-only variables do not automatically configure previews. Do not attach previews to production data.

## 4. Verify the deployment

1. Open `https://glowbbdashboard.vercel.app/api/ready`. Expect JSON containing `ready: true` and `schemaVersion: 1`.
2. Load the dashboard; it should show empty data until attendance is imported.
3. Import a small non-sensitive CSV using the exact headers in [`attendance-template.csv`](attendance-template.csv). Preview and confirm it.
4. Reimport the same file. Confirmation should add zero duplicate attendance.
5. Save a target or planning decision, redeploy Vercel, and confirm that attendance and saved changes remain.
6. Check CSV exports and the printable report.

Local tests use an embedded PostgreSQL engine to verify migration SQL, API operations, cross-instance preview confirmation and transaction rollback. A live Supabase/Vercel check is still required after account setup.

Hosted uploads must be **under 4 MB** to leave room for multipart overhead below Vercel's function payload limit. Split larger files. Local SQLite mode retains its 8 MB file limit.

Import previews contain parsed, pseudonymised attendance data and are stored in the database across function restarts. They expire after 20 minutes and are deleted on confirmation, cancellation or cleanup during the next preview upload. Expiration prevents confirmation; it does not schedule physical deletion. For cleanup independent of traffic, schedule this query through your approved database job mechanism:

```sql
DELETE FROM glowbb.import_previews
WHERE expires < extract(epoch FROM now()) * 1000;
```

Login remains removed as in the existing application. Anyone who can reach the deployment can read or modify the workspace; database RLS does not authenticate the Express API. Resolve access control before using a public deployment for personal attendance data.

## Local development and existing SQLite data

Without `DATABASE_URL`, `npm.cmd run dev` continues to use `data/glowbb.sqlite`. The Supabase migration does not move or overwrite that file. At preparation time it contained zero participants, attendance entries, targets or planning decisions.

To develop against a separate test Supabase project, copy `.env.example` to `.env.local`, enter that project's URI, and change `APP_ORIGIN` to `http://127.0.0.1:3000`. `npm.cmd run dev` and `npm.cmd start` load that ignored file. Never use the production database for local testing.

If local data is imported before switching, back up SQLite and plan a separate transfer. The schema migration does not transfer attendance, settings or planning decisions; reimporting source attendance does not transfer staff notes. Supabase backups follow your project plan and backup configuration; SQLite file backups do not back up Supabase.

## Troubleshooting

- **503 mentioning `DATABASE_URL`:** set the variable in the correct Vercel environment and redeploy.
- **Database unavailable / setup incomplete:** check provisioning, the migration, the pooler URI and password. Vercel function logs record database error codes without SQL or participant data. Certificate errors may require `DATABASE_CA_CERT`; do not disable verification.
- **403 on save/import:** `APP_ORIGIN` must exactly match the browser origin, without a trailing slash. Preview and custom domains have different origins.
- **Preview expired:** upload again. The 20-minute limit applies across deployments.
- **Upload rejected:** use one CSV/XLSX smaller than 4 MB and at most 50,000 rows. `.xls` is unsupported.

The previous Express/SQLite deployment with `render.yaml` remains an alternative. It needs a persistent disk, `APP_ORIGIN` matching Vercel, and `DASHBOARD_BACKEND_URL` in Vercel. Leave `DATABASE_URL` unset when intentionally using that proxy mode.
