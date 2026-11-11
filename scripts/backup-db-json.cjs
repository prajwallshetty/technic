/**
 * Consistent, read-only backup of every table in a database to newline-
 * delimited JSON, with a checksummed manifest. For hosts without pg_dump.
 *
 *   node scripts/backup-db-json.cjs [ENV_VAR_NAME]     (default DATABASE_URL)
 *
 * Reads the connection string from .env, never prints it, and reads through a
 * READ ONLY REPEATABLE READ transaction so the source cannot be changed.
 * Output: backups/<label>-<timestamp>/<table>.ndjson + manifest.json
 * (git-ignored — it contains customer data). Values are the raw text Postgres
 * returns; bytea columns are written as {"$base64": "..."}.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client, types } = require("pg");

for (const oid of [1082, 1114, 1184, 114, 3802]) types.setTypeParser(oid, (v) => v);

const name = process.argv[2] || "DATABASE_URL";
const url = (() => {
  for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?/);
    if (m && m[1] === name) return m[2];
  }
})();
if (!url) { console.error(`${name} is not set in .env`); process.exit(1); }

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, keepAlive: true });
  c.on("error", () => {});
  await c.connect();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join("backups", `${name.toLowerCase()}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const host = new URL(url).host;
    const tables = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")).rows.map((r) => r.table_name);
    const manifest = { source: name, host, takenAt: new Date().toISOString(), tables: {} };
    for (const t of tables) {
      const rows = (await c.query(`select * from "${t}"`)).rows;
      const file = path.join(dir, `${t}.ndjson`);
      const out = fs.createWriteStream(file);
      const hash = crypto.createHash("sha256");
      for (const row of rows) {
        for (const k of Object.keys(row)) if (Buffer.isBuffer(row[k])) row[k] = { $base64: row[k].toString("base64") };
        const line = JSON.stringify(row) + "\n";
        hash.update(line);
        out.write(line);
      }
      await new Promise((r) => out.end(r));
      manifest.tables[t] = { rows: rows.length, sha256: hash.digest("hex") };
    }
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const total = Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0);
    console.log(`Backup of ${name} (${host}): ${tables.length} tables, ${total} rows -> ${dir}`);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
})().catch((e) => { console.error("Backup failed:", e.message); process.exit(1); });
