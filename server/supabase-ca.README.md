# Supabase public database CA

`supabase-ca.crt` is a public certificate, not a credential. It was downloaded over verified HTTPS from:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Subject: `Supabase Root 2021 CA`, Supabase Inc.

SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

Valid until 26 April 2031. Update this file from the provider's authenticated HTTPS source when Supabase rotates its root. See [Supabase's SSL documentation](https://supabase.com/docs/guides/platform/ssl-enforcement).

The app adds this certificate to its trusted authorities only for official Supabase database and pooler hostnames. Other providers retain the standard Node.js roots. Additional `DATABASE_CA_CERT` authorities remain supported. Chain and hostname verification stay enabled; certificates are never fetched from the database connection at runtime.

`vercel.json` explicitly includes the certificate in the function bundle.
