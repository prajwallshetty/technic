/**
 * One-off ERP database migration: copies master and operational data from the
 * source database to a new, empty destination — WITHOUT invoices, quotations
 * or anything that would recreate them.
 *
 *   node scripts/migrate-erp-database.cjs [--apply]
 *
 * Connection strings come from .env and are never printed:
 *   DATABASE_URL  source (read only — it is read through a READ ONLY transaction)
 *   NEW_DB        destination (must already have the schema, and must be empty)
 *
 * Without --apply the whole copy runs inside a transaction that is rolled back,
 * so the foreign keys and types are exercised but nothing is kept.
 *
 * Rules (derived from the live foreign-key graph, not hard-coded per table):
 *   - EXCLUDED tables are skipped entirely.
 *   - A row whose foreign key points at an excluded/missing parent has that
 *     reference set to NULL when the column is nullable, otherwise the row is
 *     dropped (it only exists for the excluded document).
 *   - Audit-log rows about invoices, quotations or the import queue are dropped.
 *   - Customer invoice rollups are reset, since their invoices are not copied.
 */
const fs = require("fs");
const { Client, types } = require("pg");

const APPLY = process.argv.includes("--apply");

const EXCLUDED_TABLES = new Set([
  "invoices", "invoice_lines", "quotations", "quotation_lines",
  "purchase_invoices", "purchase_invoice_lines",
  "invoice_import_batches", "invoice_import_documents", "invoice_import_files",
]);
const EXCLUDED_AUDIT_ENTITIES = ["Invoice", "InvoiceLine", "Quotation", "QuotationLine", "PurchaseInvoice", "InvoiceImportDocument", "InvoiceImportBatch"];
const EXCLUDED_AUDIT_ACTION_PREFIXES = ["INVOICE_", "QUOTATION_"];
const SKIP_TABLES = new Set(["_prisma_migrations"]);

// Round-trip dates, numerics and JSON exactly as stored (no JS conversion).
for (const oid of [1082, 1114, 1184, 114, 3802]) types.setTypeParser(oid, (v) => v);

function env() {
  const out = {};
  for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const hostOf = (url) => new URL(url).host;
const q = (id) => `"${id.replace(/"/g, '""')}"`;

async function main() {
  const cfg = env();
  if (!cfg.DATABASE_URL || !cfg.NEW_DB) throw new Error("DATABASE_URL and NEW_DB must both be set in .env");
  if (hostOf(cfg.DATABASE_URL) === hostOf(cfg.NEW_DB) && new URL(cfg.DATABASE_URL).pathname === new URL(cfg.NEW_DB).pathname) {
    throw new Error("Source and destination are the same database — refusing to continue");
  }
  console.log(`Source:      ${hostOf(cfg.DATABASE_URL)} (read only)`);
  console.log(`Destination: ${hostOf(cfg.NEW_DB)} (${APPLY ? "WRITE + COMMIT" : "dry run — rolled back"})\n`);

  const opts = { ssl: { rejectUnauthorized: false }, keepAlive: true, keepAliveInitialDelayMillis: 5000 };
  const src = new Client({ connectionString: cfg.DATABASE_URL, ...opts });
  const dst = new Client({ connectionString: cfg.NEW_DB, ...opts });
  // A dropped connection surfaces as a rejected query (and rolls the
  // all-or-nothing transaction back) instead of an unhandled 'error' event.
  src.on("error", () => {});
  dst.on("error", () => {});
  await src.connect();
  await dst.connect();

  try {
    await src.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    // ---- metadata from the destination ------------------------------------
    const tables = (await dst.query(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
    )).rows.map((r) => r.table_name).filter((t) => !SKIP_TABLES.has(t));
    const columns = new Map();
    for (const t of tables) {
      const r = await dst.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [t]);
      columns.set(t, r.rows.map((x) => x.column_name));
    }
    const fkRows = (await dst.query(`
      select con.conname, cl.relname child, pl.relname parent,
        (select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum) cols,
        (select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.attnum) pcols,
        (select bool_and(not a.attnotnull) from unnest(con.conkey) k(attnum) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum) nullable
      from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_class pl on pl.oid=con.confrelid
      join pg_namespace n on n.oid=cl.relnamespace where con.contype='f' and n.nspname='public'`)).rows;
    const fksByChild = new Map();
    for (const f of fkRows) fksByChild.set(f.child, [...(fksByChild.get(f.child) ?? []), f]);

    // The destination must be empty.
    for (const t of tables) {
      const n = (await dst.query(`select count(*)::int n from ${q(t)}`)).rows[0].n;
      if (n > 0) throw new Error(`Destination table ${t} already has ${n} rows — it must be empty`);
    }

    // Topological order (parents first); self references are handled per table.
    const order = [];
    const remaining = new Set(tables);
    while (remaining.size) {
      const ready = [...remaining].filter((t) => (fksByChild.get(t) ?? []).every((f) => f.parent === t || !remaining.has(f.parent)));
      if (!ready.length) throw new Error("Foreign-key cycle between: " + [...remaining].join(", "));
      for (const t of ready.sort()) { order.push(t); remaining.delete(t); }
    }

    // Keys of rows that were copied, per (table, columns), for FK checks.
    const keySets = new Map();
    const keyOf = (row, cols) => cols.map((c) => String(row[c])).join("\u0001");
    const wanted = new Map(); // table -> Set(colsKey)
    for (const f of fkRows) {
      const k = f.pcols.join(",");
      wanted.set(f.parent, new Set([...(wanted.get(f.parent) ?? []), k]));
    }
    const register = (table, row) => {
      for (const k of wanted.get(table) ?? []) {
        const cols = k.split(",");
        const id = `${table}|${k}`;
        if (!keySets.has(id)) keySets.set(id, new Set());
        keySets.get(id).add(keyOf(row, cols));
      }
    };

    await dst.query("BEGIN");
    const report = [];

    for (const table of order) {
      if (EXCLUDED_TABLES.has(table)) {
        const n = (await src.query(`select count(*)::int n from ${q(table)}`)).rows[0].n;
        report.push({ table, source: n, copied: 0, dropped: 0, nulled: 0, note: "excluded" });
        continue;
      }
      let where = "";
      if (table === "audit_logs") {
        const ents = EXCLUDED_AUDIT_ENTITIES.map((e) => `'${e}'`).join(",");
        const acts = EXCLUDED_AUDIT_ACTION_PREFIXES.map((p) => `action::text like '${p}%'`).join(" or ");
        where = ` where not (entity in (${ents}) or ${acts})`;
      }
      const total = (await src.query(`select count(*)::int n from ${q(table)}`)).rows[0].n;
      const cols = columns.get(table);
      let rows = (await src.query(`select ${cols.map(q).join(", ")} from ${q(table)}${where}`)).rows;
      const filtered = total - rows.length;

      const fks = fksByChild.get(table) ?? [];
      const selfFks = fks.filter((f) => f.parent === table);
      const otherFks = fks.filter((f) => f.parent !== table);
      let dropped = 0, nulled = 0;
      const keep = [];
      const pending = [];
      for (const row of rows) {
        let drop = false;
        for (const f of otherFks) {
          if (f.cols.some((c) => row[c] === null)) continue;
          const present = !EXCLUDED_TABLES.has(f.parent) && keySets.get(`${f.parent}|${f.pcols.join(",")}`)?.has(keyOf(row, f.cols));
          if (present) continue;
          if (f.nullable) { for (const c of f.cols) row[c] = null; nulled++; } else { drop = true; break; }
        }
        if (drop) dropped++;
        else (selfFks.length ? pending : keep).push(row);
      }
      // Self-referencing tables (categories): insert parents before children.
      if (selfFks.length) {
        let guard = pending.length + 1;
        while (pending.length && guard-- > 0) {
          for (let i = pending.length - 1; i >= 0; i--) {
            const row = pending[i];
            const ok = selfFks.every((f) => f.cols.some((c) => row[c] === null) || keySets.get(`${table}|${f.pcols.join(",")}`)?.has(keyOf(row, f.cols)) || keep.includes(row));
            const parentsInKeep = selfFks.every((f) => f.cols.some((c) => row[c] === null) || keep.some((p) => keyOf(p, f.pcols) === keyOf(row, f.cols)));
            if (ok || parentsInKeep) { keep.push(row); pending.splice(i, 1); for (const k of wanted.get(table) ?? []) { /* registered after insert */ } }
          }
        }
        for (const row of pending) { for (const f of selfFks) for (const c of f.cols) row[c] = null; nulled++; keep.push(row); }
      }

      // Customers: invoice rollups belong to the excluded invoices.
      let reset = 0;
      if (table === "customers") {
        for (const row of keep) {
          if (Number(row.invoiceCount) || Number(row.totalBilled) || row.lastInvoiceAt) reset++;
          row.invoiceCount = 0; row.totalBilled = "0.00"; row.outstandingAmount = row.openingBalance; row.lastInvoiceAt = null;
        }
      }

      // Insert in batches.
      const per = Math.max(1, Math.floor(60000 / cols.length));
      const batch = Math.min(200, per);
      for (let i = 0; i < keep.length; i += batch) {
        const slice = keep.slice(i, i + batch);
        const params = [];
        const tuples = slice.map((row) => `(${cols.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(",")})`);
        await dst.query(`insert into ${q(table)} (${cols.map(q).join(",")}) values ${tuples.join(",")}`, params);
      }
      for (const row of keep) register(table, row);
      report.push({ table, source: total, copied: keep.length, dropped: dropped + filtered, nulled, note: [filtered ? `${filtered} filtered by rule` : "", reset ? `${reset} customer rollups reset` : ""].filter(Boolean).join("; ") });
    }

    // ---- verify inside the transaction ---------------------------------------
    let excludedLeak = 0;
    for (const t of EXCLUDED_TABLES) excludedLeak += (await dst.query(`select count(*)::int n from ${q(t)}`)).rows[0].n;
    console.log("table".padEnd(34), "source".padStart(7), "copied".padStart(7), "dropped".padStart(8), "nulled".padStart(7), " note");
    for (const r of report.filter((r) => r.source || r.copied)) {
      console.log(r.table.padEnd(34), String(r.source).padStart(7), String(r.copied).padStart(7), String(r.dropped).padStart(8), String(r.nulled).padStart(7), " " + r.note);
    }
    console.log(`\nRows in excluded tables on destination: ${excludedLeak}`);
    if (excludedLeak) throw new Error("Excluded tables are not empty on the destination");

    if (APPLY) { await dst.query("COMMIT"); console.log("\nCOMMITTED to destination."); }
    else { await dst.query("ROLLBACK"); console.log("\nDry run complete — ROLLED BACK, destination unchanged."); }
  } catch (error) {
    await dst.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await src.query("ROLLBACK").catch(() => {});
    await src.end();
    await dst.end();
  }
}

main().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
