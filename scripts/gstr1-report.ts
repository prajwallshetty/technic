/**
 * Builds the GSTR-1 report for a GSTIN and tax period from the ERP's real
 * records, prints the validation findings and reconciliation, and writes the
 * Excel workbook (and the portal JSON when nothing blocks it).
 *
 *   npm run gstr1 -- --month 2026-09 [--firm <id>] [--gstin <gstin>] [--out reports/gstr1]
 *   npm run gstr1 -- --from 2026-04-01 --to 2026-09-30
 *
 * Read-only. Against a scratch copy of the data:
 *   PGLITE_DIR=.scratch/pg-gst DATABASE_URL="" npm run gstr1 -- --month 2026-09
 */
import fs from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/prisma";
import { gstr1WorkbookBuffer } from "../src/lib/gst/gstr1/excel";
import { buildGstr1Json } from "../src/lib/gst/gstr1/json";
import { validateGstr1Json } from "../src/lib/gst/gstr1/jsonSchema";
import { loadGstr1Input } from "../src/lib/gst/gstr1/load";
import { buildGstr1 } from "../src/lib/gst/gstr1/report";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[i + 1]?.startsWith("--") ? "true" : (process.argv[++i] ?? "true"));

function range(): { from: string; to: string } {
  const month = args.get("month");
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
  }
  if (!args.get("from") || !args.get("to")) throw new Error("Give --month YYYY-MM, or --from and --to");
  return { from: args.get("from")!, to: args.get("to")! };
}

const money = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

async function main() {
  const { from, to } = range();
  const firmId = args.get("firm") ?? (await prisma.firm.findFirstOrThrow({ where: { deletedAt: null, gstin: { not: null } }, orderBy: { createdAt: "asc" } })).id;
  const input = await loadGstr1Input({ firmId, from, to, gstin: args.get("gstin") });
  const rep = buildGstr1(input);
  const T = rep.totals;

  console.log(`\nGSTR-1  ${rep.period.label}   GSTIN ${rep.firm.gstin}`);
  console.log(`Rules for this period: B2CL limit ₹${rep.rulesApplied.b2clThreshold.toLocaleString("en-IN")}, HSN ≥ ${rep.rulesApplied.hsnMinDigits} digits, HSN split ${rep.rulesApplied.hsnSplit ? "B2B/B2C" : "single table"}`);
  console.log(`Documents: ${T.invoiceCount} invoices, ${T.noteCount} notes, ${T.cancelledCount} cancelled\n`);
  const rows: [string, string][] = [
    ["B2B", `${T.b2b.invoices} invoices · ${T.b2b.recipients} recipients · value ${money(T.b2b.value)} · taxable ${money(T.b2b.taxable)}`],
    ["B2CL", `${T.b2cl.invoices} invoices · value ${money(T.b2cl.value)} · taxable ${money(T.b2cl.taxable)}`],
    ["B2CS", `taxable ${money(T.b2cs.taxable)} (${rep.b2cs.length} rows)`],
    ["CDNR / CDNUR", `${T.cdnr.notes} / ${T.cdnur.notes} notes`],
    ["Exports", `${T.exp.invoices} invoices`],
    ["Advances 11A / 11B", `${money(T.at.amount)} / ${money(T.atadj.amount)}`],
    ["Nil / exempt / non-GST", `${money(T.exemp.nil)} / ${money(T.exemp.exempted)} / ${money(T.exemp.nonGst)}`],
    ["HSN rows B2B / B2C / items", `${rep.hsnB2b.length} / ${rep.hsnB2c.length} / ${rep.items.length}`],
    ["Table 13", rep.docs.map((d) => `${d.nature} ${d.from}–${d.to} (${d.total}${d.cancelled ? `, ${d.cancelled} cancelled` : ""}${d.missing.length ? `, ${d.missing.length} missing` : ""})`).join("; ") || "—"],
    ["NET (report total)", `value ${money(T.net.value)} · taxable ${money(T.net.taxable)} · IGST ${money(T.net.igst)} · CGST ${money(T.net.cgst)} · SGST ${money(T.net.sgst)}`],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(26)} ${v}`);

  console.log("\nReconciliation:");
  for (const r of rep.reconciliation) console.log(`  ${r.ok === null ? "n/a " : r.ok ? "OK  " : "DIFF"} ${r.label.padEnd(52)} reported ${money(r.reported).padStart(16)}  ${r.source.slice(0, 38).padEnd(38)} ${money(r.expected).padStart(16)}${r.ok === false ? `  Δ ${money(r.difference)}` : ""}`);

  const byCode = new Map<string, { sev: string; n: number; sample: string; blocking: boolean }>();
  for (const i of rep.issues) {
    const e = byCode.get(i.code) ?? { sev: i.severity, n: 0, sample: i.message, blocking: i.blocking };
    e.n++; byCode.set(i.code, e);
  }
  console.log(`\nValidation: ${rep.issues.filter((i) => i.severity === "ERROR").length} errors, ${rep.issues.filter((i) => i.severity === "WARNING").length} warnings, ${rep.issues.filter((i) => i.severity === "INFO").length} info (${rep.issues.filter((i) => i.blocking).length} blocking)`);
  for (const [code, e] of [...byCode].sort((a, b) => a[1].sev.localeCompare(b[1].sev) || b[1].n - a[1].n)) console.log(`  ${e.sev.padEnd(7)} ${String(e.n).padStart(3)} × ${code}${e.blocking ? " [blocking]" : ""}\n            e.g. ${e.sample.slice(0, 170)}`);

  const out = args.get("out") ?? "reports/gstr1";
  fs.mkdirSync(out, { recursive: true });
  const base = path.join(out, `GSTR1_${rep.firm.gstin}_${rep.period.fp}`);
  fs.writeFileSync(`${base}.xlsx`, await gstr1WorkbookBuffer(rep));
  fs.writeFileSync(`${base}.issues.json`, JSON.stringify(rep.issues, null, 2));
  const json = buildGstr1Json(rep);
  if (json.json) {
    fs.writeFileSync(`${base}.json`, JSON.stringify(json.json, null, 2));
    const v = validateGstr1Json(json.json);
    console.log(`\nJSON written; structural check ${v.ok ? "passed" : "FAILED: " + v.errors.slice(0, 3).join("; ")}. ${v.caveat}`);
  } else {
    console.log(`\nPortal JSON NOT produced — ${json.blockers.length} blocker(s):`);
    for (const b of json.blockers.slice(0, 6)) console.log(`  • ${b.slice(0, 190)}`);
    if (json.blockers.length > 6) console.log(`  … and ${json.blockers.length - 6} more`);
  }
  console.log(`Excel written: ${base}.xlsx`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
