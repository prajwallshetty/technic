/**
 * Restores the production sales invoices from the original database into the
 * new one, exactly as they are (same IDs, numbers, dates, customers, lines and
 * stored GST figures). Nothing is recalculated or retyped.
 *
 *   node scripts/restore-invoices.cjs [--apply]
 *
 *   OLD_DATABASE_URL  source — read only (READ ONLY transaction), never modified
 *   DATABASE_URL      destination
 *
 * Copies: invoices, invoice_lines, the invoice-created audit entries for those
 * invoices, and the per-customer invoice rollups (invoiceCount, totalBilled,
 * outstandingAmount, lastInvoiceAt). Does NOT touch quotations, stock or
 * payments. Without --apply the whole thing runs in a transaction that is
 * rolled back.
 */
const fs = require("fs");
const { Client, types } = require("pg");

for (const oid of [1082, 1114, 1184, 114, 3802]) types.setTypeParser(oid, (v) => v);
const APPLY = process.argv.includes("--apply");
const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?/);
  if (m) env[m[1]] = m[2];
}
const q = (id) => `"${id}"`;

async function open(name) {
  const c = new Client({ connectionString: env[name], ssl: { rejectUnauthorized: false }, keepAlive: true });
  c.on("error", () => {});
  await c.connect();
  return c;
}
async function insertRows(db, table, cols, rows) {
  const batch = Math.max(1, Math.min(100, Math.floor(60000 / cols.length)));
  for (let i = 0; i < rows.length; i += batch) {
    const params = [];
    const tuples = rows.slice(i, i + batch).map((row) => `(${cols.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(",")})`);
    await db.query(`insert into ${q(table)} (${cols.map(q).join(",")}) values ${tuples.join(",")}`, params);
  }
}
async function columnsOf(db, table) {
  return (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [table])).rows.map((r) => r.column_name);
}

(async () => {
  if (new URL(env.DATABASE_URL).host === new URL(env.OLD_DATABASE_URL).host && new URL(env.DATABASE_URL).pathname === new URL(env.OLD_DATABASE_URL).pathname) throw new Error("Source and destination are the same");
  console.log(`Source:      ${new URL(env.OLD_DATABASE_URL).host} (read only)`);
  console.log(`Destination: ${new URL(env.DATABASE_URL).host} (${APPLY ? "WRITE + COMMIT" : "dry run — rolled back"})\n`);
  const src = await open("OLD_DATABASE_URL");
  const dst = await open("DATABASE_URL");
  try {
    await src.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await dst.query("BEGIN");

    // ---- pre-checks ------------------------------------------------------------
    const existing = (await dst.query("select (select count(*) from invoices)::int i, (select count(*) from invoice_lines)::int l")).rows[0];
    if (existing.i || existing.l) throw new Error(`Destination already has ${existing.i} invoices / ${existing.l} lines`);

    const invCols = await columnsOf(dst, "invoices");
    const lineCols = await columnsOf(dst, "invoice_lines");
    const invoices = (await src.query(`select ${invCols.map(q).join(",")} from invoices order by "invoiceNumber"`)).rows;
    const lines = (await src.query(`select ${lineCols.map(q).join(",")} from invoice_lines`)).rows;
    console.log(`Source: ${invoices.length} invoices, ${lines.length} lines`);

    const need = async (table, col, values, label) => {
      const ids = [...new Set(values.filter(Boolean))];
      if (!ids.length) return;
      const found = new Set((await dst.query(`select "${col}" v from "${table}" where "${col}" = any($1)`, [ids])).rows.map((r) => r.v));
      const missing = ids.filter((v) => !found.has(v));
      if (missing.length) throw new Error(`${missing.length} ${label} referenced by invoices are missing on the destination: ${missing.slice(0, 3).join(", ")}`);
    };
    await need("firms", "id", invoices.map((i) => i.firmId), "firms");
    await need("branches", "id", invoices.map((i) => i.branchId), "branches");
    await need("customers", "id", invoices.map((i) => i.customerId), "customers");
    await need("users", "id", invoices.map((i) => i.createdById), "users");
    await need("products", "id", lines.map((l) => l.productId), "products");
    await need("product_variants", "id", lines.map((l) => l.variantId), "variants");
    const orphanLines = lines.filter((l) => !invoices.some((i) => i.id === l.invoiceId));
    if (orphanLines.length) throw new Error(`${orphanLines.length} lines have no invoice`);
    // Source-side consistency (stored figures, as printed): header total = sum of line totals.
    const bad = invoices.filter((inv) => {
      const sum = lines.filter((l) => l.invoiceId === inv.id).reduce((n, l) => n + Number(l.lineTotal), 0);
      return Math.abs(sum - (Number(inv.totalAmount) - Number(inv.roundOff))) > 0.06 * lines.filter((l) => l.invoiceId === inv.id).length;
    });
    console.log(`Header-vs-lines consistency issues in source: ${bad.length}${bad.length ? " (" + bad.map((b) => b.invoiceNumber).join(", ") + ")" : ""}`);

    // ---- copy ------------------------------------------------------------------------
    await insertRows(dst, "invoices", invCols, invoices);
    await insertRows(dst, "invoice_lines", lineCols, lines);

    const auditCols = await columnsOf(dst, "audit_logs");
    const ids = invoices.map((i) => i.id);
    const audit = (await src.query(`select ${auditCols.map(q).join(",")} from audit_logs where entity='Invoice' and action::text='INVOICE_CREATED' and "entityId" = any($1) order by "createdAt"`, [ids])).rows;
    // Keep the audit rows only if their user/firm/branch still exist.
    const okAudit = [];
    for (const a of audit) {
      const u = a.userId ? (await dst.query('select 1 from users where id=$1', [a.userId])).rowCount : 1;
      if (u) okAudit.push(a);
    }
    if (okAudit.length) await insertRows(dst, "audit_logs", auditCols, okAudit);

    // Customer invoice rollups, copied from the source as they were.
    const custIds = [...new Set(invoices.map((i) => i.customerId))];
    const roll = (await src.query(`select id,"invoiceCount","totalBilled","outstandingAmount","lastInvoiceAt" from customers where id = any($1)`, [custIds])).rows;
    for (const r of roll) {
      await dst.query(`update customers set "invoiceCount"=$2,"totalBilled"=$3,"outstandingAmount"=$4,"lastInvoiceAt"=$5 where id=$1`, [r.id, r.invoiceCount, r.totalBilled, r.outstandingAmount, r.lastInvoiceAt]);
    }

    // ---- verify inside the transaction ---------------------------------------------
    const v = (await dst.query(`select count(*)::int n, sum("totalAmount")::text total, sum("taxableAmount")::text taxable, sum("cgstAmount"+"sgstAmount"+"igstAmount")::text gst from invoices`)).rows[0];
    const sv = (await src.query(`select count(*)::int n, sum("totalAmount")::text total, sum("taxableAmount")::text taxable, sum("cgstAmount"+"sgstAmount"+"igstAmount")::text gst from invoices`)).rows[0];
    const vl = (await dst.query(`select count(*)::int n, sum("lineTotal")::text lt from invoice_lines`)).rows[0];
    const sl = (await src.query(`select count(*)::int n, sum("lineTotal")::text lt from invoice_lines`)).rows[0];
    console.log(`Invoices  source ${JSON.stringify(sv)}\n          dest   ${JSON.stringify(v)}`);
    console.log(`Lines     source ${JSON.stringify(sl)}\n          dest   ${JSON.stringify(vl)}`);
    console.log(`Audit entries copied: ${okAudit.length} of ${audit.length}; customer rollups restored: ${roll.length}`);
    if (JSON.stringify(sv) !== JSON.stringify(v) || JSON.stringify(sl) !== JSON.stringify(vl)) throw new Error("Totals differ between source and destination");
    const rollBad = (await dst.query(`select count(*)::int n from customers c where c.id = any($1) and c."totalBilled" <> coalesce((select sum(i."totalAmount") from invoices i where i."customerId"=c.id and i.status<>'CANCELLED'),0)`, [custIds])).rows[0].n;
    console.log(`Customers whose stored totalBilled differs from their invoices: ${rollBad}`);
    if (rollBad) throw new Error("Customer rollups do not match their invoices");

    if (APPLY) { await dst.query("COMMIT"); console.log("\nCOMMITTED."); } else { await dst.query("ROLLBACK"); console.log("\nDry run — ROLLED BACK."); }
  } catch (e) {
    await dst.query("ROLLBACK").catch(() => {});
    console.error("\nFAILED:", e.message);
    process.exitCode = 1;
  } finally {
    await src.query("ROLLBACK").catch(() => {});
    await src.end(); await dst.end();
  }
})();
