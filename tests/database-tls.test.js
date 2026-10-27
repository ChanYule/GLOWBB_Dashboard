import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { postgresOptions } from "../server/postgres.js";

const bundled = readFileSync(
  new URL("../server/supabase-ca.crt", import.meta.url),
  "utf8",
);

test("Supabase connections trust the bundled public CA without certificate environment setup", () => {
  const certificate = new X509Certificate(bundled);
  assert.equal(certificate.ca, true);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.equal(
    certificate.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  assert.ok(Date.parse(certificate.validTo) > Date.now());
  for (const host of [
    "aws-0-ap-southeast-1.pooler.supabase.com",
    "db.project-ref.supabase.co",
  ]) {
    const options = postgresOptions(
      `postgresql://postgres:example@${host}:6543/postgres?sslmode=no-verify`,
      "",
    );
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.ok(options.ssl.ca.includes(bundled));
    assert.ok(!new URL(options.connectionString).searchParams.has("sslmode"));
    assert.equal(options.max, 1);
  }
  const config = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.equal(
    config.functions["api/**/*.js"].includeFiles,
    "server/supabase-ca.crt",
  );
});

test("additional CA trust is scoped to Supabase and custom certificate support is preserved", () => {
  for (const host of [
    "database.example.com",
    "aws-0.pooler.supabase.com.attacker.example",
    "fake-supabase.co",
  ]) {
    const options = postgresOptions(
      `postgresql://postgres:example@${host}/postgres`,
      "",
    );
    assert.deepEqual(options.ssl.ca, [...rootCertificates]);
    assert.equal(options.ssl.rejectUnauthorized, true);
  }
  const custom =
    "-----BEGIN CERTIFICATE-----\\ncustom\\n-----END CERTIFICATE-----";
  const options = postgresOptions(
    "postgresql://postgres:example@aws-0-us-east-1.pooler.supabase.com/postgres",
    custom,
  );
  assert.ok(options.ssl.ca.includes(custom.replaceAll("\\n", "\n")));
  assert.ok(options.ssl.ca.includes(bundled));
});
