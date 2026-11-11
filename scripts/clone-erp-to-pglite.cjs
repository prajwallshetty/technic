/**
 * Makes a throwaway local copy of the ERP data for development and testing, so
 * features (e.g. the GSTR-1 report) can be exercised on the real records
 * without touching the live database.
 *
 *   node scripts/clone-erp-to-pglite.cjs <target-dir> [SOURCE_ENV_VAR]
 *
 * Source: the connection string named by SOURCE_ENV_VAR in .env (default
 * DATABASE_URL), read through a READ ONLY transaction — it is never written to.
 * Target: a PGlite database in <target-dir>, built from prisma/full_schema.sql
 * plus every migration (exactly what the app's local fallback does), then
 * filled table by table in foreign-key order. Columns that exist only in the
 * target (e.g. newly migrated ones) take their defaults.
 *
 * Use it with the app via:  PGLITE_DIR=<target-dir> DATABASE_URL="" ...
 */
const fs = require("fs");
const path = require("path");
const { Client, types } = require("pg");
const { PGlite } = require("@electric-sql/pglite");

for (const oid of [1082, 1114, 1184, 114, 3802]) types.setTypeParser(oid, (v) => v);

const [targetDir, sourceVar = "DATABASE_URL"] = process.argv.slice(2);
if (!targetDir) { console.error("usage: node scripts/clone-erp-to-pglite.cjs <target-dir> [SOURCE_ENV_VAR]"); process.exit(1); }

const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?/);
  if (m) env[m[1]] = m[2];
}
const q = (id) => `"${id}"`;

(async () => {
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length) throw new Error(`${targetDir} is not empty — refusing to overwrite`);
  const src = new Client({ connectionString: env[sourceVar], ssl: { rejectUnauthorized: false }, keepAlive: true });
  src.on("error", () => {});
  await src.connect();
  await src.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const db = new PGlite(targetDir);
  await db.exec(fs.readFileSync("prisma/full_schema.sql", "utf8"));
  const migrations = fs.readdirSync("prisma/migrations", { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "0_init").map((d) => d.name).sort();
  for (const m of migrations) {
    const file = path.join("prisma/migrations", m, "migration.sql");
    if (fs.existsSync(file)) { try { await db.exec(fs.readFileSync(file, "utf8")); } catch (e) { console.log(`  (migration ${m}: ${String(e.message).split("\n")[0]})`); } }
  }

  const tables = (await db.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")).rows.map((r) => r.table_name);
  const fks = (await db.query(`
    select cl.relname child, pl.relname parent from pg_constraint con
    join pg_class cl on cl.oid=con.conrelid join pg_class pl on pl.oid=con.confrelid join pg_namespace n on n.oid=cl.relnamespace
    where con.contype='f' and n.nspname='public'`)).rows;
  const order = [], left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => fks.filter((f) => f.child === t && f.parent !== t).every((f) => !left.has(f.parent)));
    if (!ready.length) { order.push(...left); break; }
    for (const t of ready.sort()) { order.push(t); left.delete(t); }
  }

  let total = 0;
  for (const t of order) {
    const exists = (await src.query("select 1 from information_schema.tables where table_schema='public' and table_name=$1", [t])).rowCount;
    if (!exists) continue;
    const dstCols = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [t])).rows.map((r) => r.column_name);
    const srcCols = new Set((await src.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [t])).rows.map((r) => r.column_name));
    const cols = dstCols.filter((c) => srcCols.has(c));
    const rows = (await src.query(`select ${cols.map(q).join(",")} from ${q(t)}`)).rows;
    for (let i = 0; i < rows.length; i += 100) {
      const slice = rows.slice(i, i + 100), params = [];
      const tuples = slice.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(",")})`);
      await db.query(`insert into ${q(t)} (${cols.map(q).join(",")}) values ${tuples.join(",")}`, params);
    }
    if (rows.length) { console.log(`  ${t.padEnd(32)} ${rows.length}`); total += rows.length; }
  }
  console.log(`Cloned ${total} rows into ${targetDir}`);
  await src.query("ROLLBACK").catch(() => {});
  await src.end();
  await db.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
