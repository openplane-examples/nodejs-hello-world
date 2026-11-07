// OpenPlane example: an Express app that says hello and reads one row from
// the managed Postgres the platform names in DATABASE_URL.
//
// - PORT is the platform's (8080 when the deploy names none).
// - DATABASE_URL carries sslmode=verify-full, sslrootcert=<path> and
//   channel_binding=require. DATABASE_CA_CERT holds the path of the CA file
//   OpenPlane delivers next to the instance. The certificate is always
//   verified against that CA: verification is never turned off.
// - The URL carries a password: this file never prints it.
"use strict";

const fs = require("node:fs");
const express = require("express");
const { Pool } = require("pg");

const port = Number(process.env.PORT || 8080);

function poolFromEnvironment() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;

  const url = new URL(raw);
  const caPath = process.env.DATABASE_CA_CERT || url.searchParams.get("sslrootcert");
  const channelBinding = url.searchParams.get("channel_binding") === "require";
  for (const key of ["sslmode", "sslrootcert", "channel_binding"]) {
    url.searchParams.delete(key);
  }

  if (!caPath) {
    throw new Error("DATABASE_URL is set but no CA file is named (DATABASE_CA_CERT)");
  }

  return new Pool({
    connectionString: url.toString(),
    ssl: { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true },
    enableChannelBinding: channelBinding,
    max: 2,
    connectionTimeoutMillis: 5000,
  });
}

const pool = poolFromEnvironment();
const app = express();

app.get("/", (_req, res) => {
  res.json({ message: "hello from OpenPlane" });
});

app.get("/db", async (_req, res) => {
  if (!pool) {
    res.status(503).json({ source: "none", error: "no DATABASE_URL in this environment" });
    return;
  }
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS greetings (id integer PRIMARY KEY, message text NOT NULL)"
    );
    await pool.query(
      "INSERT INTO greetings (id, message) VALUES (1, 'hello from the OpenPlane database') ON CONFLICT (id) DO NOTHING"
    );
    const { rows } = await pool.query(
      "SELECT id, message, current_database() AS database, now() AS read_at FROM greetings ORDER BY id LIMIT 1"
    );
    res.json({ source: "postgres", row: rows[0] });
  } catch (error) {
    res.status(502).json({ source: "postgres", error: error.code || error.message });
  }
});

const server = app.listen(port, () => {
  console.log(`listening on ${port}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, closing`);
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
