import type { Sections } from "./engine";
import { sectionTotals } from "./engine";
import type { GstrInput, ReconciliationLine, RegisterTotals } from "./types";
import { r2, sum } from "./util";

/**
 * Reconciles what the return reports with figures obtained independently:
 *  - the ERP sales register (header totals, from a separate query),
 *  - a database line-level aggregation (a separate calculation path),
 *  - the return's own tables against each other (HSN vs sections, docs vs counts).
 * A difference is shown, never absorbed.
 */
export function reconcile(input: GstrInput, sec: Sections): ReconciliationLine[] {
  const totals = sectionTotals(sec);
  const lines: ReconciliationLine[] = [];
  const line = (key: string, label: string, reported: number | null, expected: number | null, source: string, tol: number, note?: string) => {
    const difference = reported !== null && expected !== null ? r2(reported - expected) : null;
    lines.push({ key, label, reported, expected, difference, ok: difference === null ? null : Math.abs(difference) <= tol + 1e-9, source, note });
  };

  const live = sec.contexts.filter((c) => c.section !== "CANCELLED");
  const docCount = Math.max(1, live.length);
  const tolRound = Math.max(0.05, 0.01 * docCount); // header vs line-level rounding across the period

  // ---- what the return reports, by section (signed: credit notes reduce) ---------------------------
  const signedNotes = <T extends { noteType: "C" | "D"; taxable: number; igst?: number; cgst?: number; sgst?: number; cess: number }>(rows: T[], k: "taxable" | "igst" | "cgst" | "sgst" | "cess") =>
    sum(rows.map((r) => (r.noteType === "C" ? -1 : 1) * ((r[k] as number | undefined) ?? 0)));
  const rep = {
    taxable: sum([sum(sec.b2b.map((r) => r.taxable)), sum(sec.b2cl.map((r) => r.taxable)), sum(sec.exp.map((r) => r.taxable)), sum(sec.b2cs.map((r) => r.taxable)), signedNotes(sec.cdnr, "taxable"), signedNotes(sec.cdnur, "taxable"), totals.exemp.nil + totals.exemp.exempted + totals.exemp.nonGst]),
    igst: sum([sum(sec.b2b.map((r) => r.igst)), sum(sec.b2cl.map((r) => r.igst)), sum(sec.exp.map((r) => r.igst)), sum(sec.b2cs.map((r) => r.igst)), signedNotes(sec.cdnr, "igst"), signedNotes(sec.cdnur, "igst")]),
    cgst: sum([sum(sec.b2b.map((r) => r.cgst)), sum(sec.b2cs.map((r) => r.cgst)), signedNotes(sec.cdnr, "cgst")]),
    sgst: sum([sum(sec.b2b.map((r) => r.sgst)), sum(sec.b2cs.map((r) => r.sgst)), signedNotes(sec.cdnr, "sgst")]),
    cess: sum([sum(sec.b2b.map((r) => r.cess)), sum(sec.b2cl.map((r) => r.cess)), sum(sec.exp.map((r) => r.cess)), sum(sec.b2cs.map((r) => r.cess)), signedNotes(sec.cdnr, "cess"), signedNotes(sec.cdnur, "cess")]),
  };

  // ---- 1. against the ERP sales register -------------------------------------------------------------------
  const reg = input.register;
  const net = (k: keyof RegisterTotals) => (reg ? r2(reg.invoices[k] + reg.debitNotes[k] - reg.creditNotes[k]) : null);
  line("count.invoices", "Invoices reported (count)", totals.invoiceCount, reg ? reg.invoices.count : null, "ERP sales register (non-cancelled invoices)", 0);
  line("count.notes", "Credit + debit notes reported (count)", totals.noteCount, reg ? reg.creditNotes.count + reg.debitNotes.count : null, "ERP register (non-cancelled notes)", 0);
  line("value.net", "Document value, net of credit notes", totals.net.value, net("total"), "ERP sales register", 0.01 * docCount);
  line("taxable", "Taxable value across all sections", rep.taxable, net("taxable"), "ERP sales register (header taxable)", tolRound, "Includes nil-rated / exempted / non-GST lines (table 8).");
  line("igst", "IGST", rep.igst, net("igst"), "ERP sales register", tolRound);
  line("cgst", "CGST", rep.cgst, net("cgst"), "ERP sales register", tolRound);
  line("sgst", "SGST", rep.sgst, net("sgst"), "ERP sales register", tolRound);
  line("cess", "Cess", rep.cess, net("cess"), "ERP sales register", tolRound);

  // ---- 2. against the ERP's GST summary report ---------------------------------------------------------------------
  const g = input.gstSummary;
  line("gst.taxable", "Taxable value vs line-level aggregation", rep.taxable, g ? g.taxable : null, "Database line aggregation (net of notes)", tolRound, "Summed from invoice and note lines by the database, independently of the rows the return was built from.");
  line("gst.igst", "IGST vs line-level aggregation", rep.igst, g ? g.igst : null, "Database line aggregation", tolRound);
  line("gst.cgst", "CGST vs line-level aggregation", rep.cgst, g ? g.cgst : null, "Database line aggregation", tolRound);
  line("gst.sgst", "SGST vs line-level aggregation", rep.sgst, g ? g.sgst : null, "Database line aggregation", tolRound);

  // ---- 3. the return against itself ---------------------------------------------------------------------------------------
  const hsnAll = [...sec.hsnB2b, ...sec.hsnB2c];
  const hsnTaxable = sum(hsnAll.map((r) => r.taxable));
  const hsnValue = sum(hsnAll.map((r) => r.value));
  const hsnTax = sum(hsnAll.map((r) => r.igst + r.cgst + r.sgst + r.cess));
  line("hsn.taxable", "HSN summary taxable value vs sections", hsnTaxable, rep.taxable, "Tables 4–11 as reported", 0.02, "Table 12 covers every line, so it equals the sections plus table 8.");
  line("hsn.tax", "HSN summary tax vs sections", hsnTax, r2(rep.igst + rep.cgst + rep.sgst + rep.cess), "Tables 4–11 as reported", 0.02);
  line("hsn.value", "HSN summary value = taxable + tax", hsnValue, r2(hsnTaxable + hsnTax), "Table 12 internal", 0.02);
  line("items.taxable", "Item summary taxable value vs HSN summary", sum(sec.items.map((r) => r.taxable)), hsnTaxable, "Table 12 vs item summary", 0.02);
  const docsTotal = sec.docs.reduce((n, s) => n + s.total, 0);
  line("docs.total", "Documents in table 13 vs documents in the period", docsTotal, sec.contexts.length, "Documents loaded for the period", 0, "Includes cancelled documents.");

  // Documents that reached no section (all-exempt invoices are in table 8; the rest should be zero).
  const placed = new Set<string>([...sec.b2b, ...sec.b2cl, ...sec.exp, ...sec.cdnr, ...sec.cdnur].map((r) => r.docId));
  const inB2cs = live.filter((c) => c.section === "B2CS").length;
  const nilOnly = live.filter((c) => c.section === "NIL_ONLY").length;
  line("coverage", "Documents placed in a section", placed.size + inB2cs + nilOnly, live.length, "Every non-cancelled document must land in a table", 0);
  return lines;
}
