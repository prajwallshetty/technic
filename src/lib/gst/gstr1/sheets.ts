import { EXEMP_CATEGORIES, fmtDateDMY, fmtDateSlash } from "./masters";
import type { DocSeriesRow, Gstr1Report, HsnRow, HsnTotals } from "./types";
import { r2 } from "./util";

/**
 * The 14 worksheets of the Vyapar GSTR-1 export, as plain cell models.
 *
 * Positions, headers, summary blocks, text-vs-number types and column widths
 * are taken from the reference workbook (a Vyapar export, data/gstr1-reference)
 * — they are layout, not data. A cell is:
 *   string  → text cell ("" is an explicit empty-text cell, as in the reference)
 *   number  → numeric cell
 *   null    → no cell
 */
export type Cell = string | number | null;

export interface SheetModel {
  name: string;
  /** Column width ranges [first, last, width], 1-based, as in the reference. */
  widths: Array<[number, number, number]>;
  /** Row number (1-based) → cells from column A. */
  rows: Array<{ row: number; cells: Cell[] }>;
}

export const SHEET_NAMES = [
  "GSTR1 Report", "b2b,sez,de", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "at", "atadj", "exemp", "hsn(b2b)", "hsn(b2c)", "itemSummary", "docs",
] as const;

const W = {
  default: 20.875,
  report: [[1, 1, 20.875], [2, 2, 30.875], [3, 5, 15.875], [6, 10, 20.875], [11, 11, 30.875], [12, 21, 20.875]],
  b2b: [[1, 1, 20.875], [2, 3, 15.875], [4, 4, 20.875], [5, 5, 40.875], [6, 7, 20.875], [8, 8, 30.875], [9, 9, 15.875], [10, 11, 20.875]],
  b2cl: [[1, 1, 20.875], [2, 2, 15.875], [3, 3, 20.875], [4, 4, 40.875], [5, 6, 20.875], [7, 7, 30.875], [8, 8, 40.875]],
  wide: [[1, 1, 22.875], [2, 2, 30.875], [3, 3, 25.875], [4, 5, 35.875], [6, 6, 20.875], [7, 13, 30.875]],
} as const;
type Widths = SheetModel["widths"];

const blanks = (n: number): Cell[] => Array.from({ length: n }, () => "");
const num = (n: number) => r2(n);

function sheet(name: string, widths: Widths, rows: Array<Cell[]>, firstRow = 1): SheetModel {
  return { name, widths, rows: rows.map((cells, i) => ({ row: firstRow + i, cells })) };
}

const HSN_HEADERS = ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"];

function hsnSheet(name: string, rows: HsnRow[], isItems: boolean, totals: HsnTotals): SheetModel {
  const distinct = new Set(rows.map((r) => r.hsn).filter(Boolean)).size;
  const t = (k: keyof HsnTotals) => num(totals[k]);
  const lines: Cell[][] = [
    ["Summary For HSN(12)", ...blanks(12)],
    ["No. of HSN", "", "", "", "Total Value", "", "Total Taxable Value", "Total Integrated Tax", "Total Central Tax", "Total State/UT Tax", "Total Cess"],
    [distinct, "", "", "", t("value"), "", t("taxable"), t("igst"), t("cgst"), t("sgst"), t("cess"), "", "", ""],
    HSN_HEADERS,
    ...rows.map((r): Cell[] => [r.hsn, isItems ? r.description : "", r.uqc, r.quantity, num(r.value), r.rate, num(r.taxable), num(r.igst), num(r.cgst), num(r.sgst), num(r.cess)]),
  ];
  return sheet(name, W.wide as unknown as Widths, lines);
}

function docsSheet(rows: DocSeriesRow[]): SheetModel {
  const total = rows.reduce((n, r) => n + r.total, 0);
  const cancelled = rows.reduce((n, r) => n + r.cancelled, 0);
  // The reference stores every number on this sheet as text.
  return sheet("docs", [], [
    ["Summary of documents issued during the tax period (13)", "", "", "", ""],
    ["", "", "", "Total Number", "Total Cancelled"],
    ["", "", "", String(total), String(cancelled)],
    ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
    ...rows.map((r): Cell[] => [r.nature, r.from, r.to, String(r.total), String(r.cancelled)]),
  ]);
}

/** Builds the 14 sheet models, in the reference's order, from a report. */
export function toSheetModels(rep: Gstr1Report): SheetModel[] {
  const T = rep.totals;

  // 1. GSTR1 Report ---------------------------------------------------------------------------------------
  const netValue = T.net.value;
  const dataRows: Cell[][] = rep.rows.map((r) => [
    r.gstin, r.partyName, r.txnType, r.number, fmtDateSlash(r.date), r.value === 0 && r.rate !== 0 ? "" : num(r.value), r.rate, r.cessRate, num(r.taxable),
    r.reverseCharge, num(r.igst), num(r.cgst), num(r.sgst), num(r.cess), r.posName,
  ]);
  const report: SheetModel = { name: "GSTR1 Report", widths: W.report as unknown as Widths, rows: [] };
  report.rows.push({ row: 1, cells: ["Period", rep.period.label] });
  report.rows.push({ row: 3, cells: ["1. GSTIN", rep.firm.gstin] });
  report.rows.push({ row: 4, cells: ["2.a Legal name of the registered person.", rep.firm.legalName ?? ""] });
  report.rows.push({ row: 5, cells: rep.firm.tradeName ? ["2.b Trade name, if any", rep.firm.tradeName] : ["2.b Trade name, if any"] });
  report.rows.push({ row: 6, cells: rep.firm.previousFyTurnover !== null ? ["3.a Aggregate turnover of the preceeding Financial Year", num(rep.firm.previousFyTurnover)] : ["3.a Aggregate turnover of the preceeding Financial Year"] });
  report.rows.push({ row: 7, cells: ["3.b Aggregate turnover, April to June 2017"] });
  report.rows.push({
    row: 9,
    cells: ["GSTIN/UIN", "Party Name", "Transaction Type", "Invoice No.", "Invoice Date", "Invoice Value", "Rate", "Cess Rate", "Taxable value", "Reverse Charge", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount", "Place of Supply(Name of state)"],
  });
  dataRows.forEach((cells, i) => report.rows.push({ row: 11 + i, cells }));
  report.rows.push({ row: 11 + dataRows.length + 1, cells: ["Total", "", "", "", "", num(netValue), "", "", num(T.net.taxable), "", num(T.net.igst), num(T.net.cgst), num(T.net.sgst), num(T.net.cess)] });

  // 2. b2b,sez,de --------------------------------------------------------------------------------------------
  const b2b = sheet("b2b,sez,de", W.b2b as unknown as Widths, [
    ["Summary For B2B, SEZ, DE (4A, 4B, 6B, 6C)", ...blanks(12)],
    ["No. of Recipients", "", "No. of Invoices", "", "Total Invoice Value", "", "", "", "", "", "", "Total Taxable Value", "Total Cess"],
    [T.b2b.recipients, "", T.b2b.invoices, "", num(T.b2b.value), "", "", "", "", "", "", num(T.b2b.taxable), num(T.b2b.cess)],
    ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
    ...rep.b2b.map((r): Cell[] => [r.gstin, r.name, r.number, fmtDateDMY(r.date), num(r.value), r.pos, r.reverseCharge, "", r.invoiceType, r.ecommerceGstin, r.rate, num(r.taxable), num(r.cess)]),
  ]);

  // 3. b2cl ------------------------------------------------------------------------------------------------------------
  const b2cl = sheet("b2cl", W.b2cl as unknown as Widths, [
    ["Summary For B2CL(5)", ...blanks(8)],
    ["No. of Invoices", "", "Total Invoice Value", "", "", "", "Total Taxable Value", "Total Cess", ""],
    [T.b2cl.invoices, "", num(T.b2cl.value), "", "", "", num(T.b2cl.taxable), num(T.b2cl.cess), ""],
    ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
    ...rep.b2cl.map((r): Cell[] => [r.number, fmtDateDMY(r.date), num(r.value), r.pos, "", r.rate, num(r.taxable), num(r.cess), r.ecommerceGstin]),
  ]);

  // 4. b2cs ---------------------------------------------------------------------------------------------------------------
  const b2cs = sheet("b2cs", [[1, 6, W.default]], [
    ["Summary For B2CS(7)", ...blanks(6)],
    ["", "", "", "", "Total Taxable Value", "Total Cess", ""],
    ["", "", "", "", num(T.b2cs.taxable), num(T.b2cs.cess), "", "", ""],
    ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
    ...rep.b2cs.map((r): Cell[] => [r.type, r.pos, "", r.rate, num(r.taxable), num(r.cess), r.ecommerceGstin]),
  ]);

  // 5. cdnr -----------------------------------------------------------------------------------------------------------------
  const cdnrValue = num(rep.cdnr.reduce((n, r, i, a) => (a.findIndex((x) => x.docId === r.docId) === i ? n + r.value : n), 0));
  const cdnr = sheet("cdnr", W.wide as unknown as Widths, [
    ["Summary For CDNR(9B)", ...blanks(5)],
    ["No. of Recipients", "", "No. of Notes", "", "", "", "", "", "Total Note Value", "", "", "Total Taxable Value", "Total Cess", ""],
    [T.cdnr.recipients, "", T.cdnr.notes, "", "", "", "", "", cdnrValue, "", "", num(T.cdnr.taxable), num(T.cdnr.cess), "", ""],
    ["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
    ...rep.cdnr.map((r): Cell[] => [r.gstin, r.name, r.number, fmtDateDMY(r.date), r.noteType, r.pos, r.reverseCharge, r.supplyType, num(r.value), "", r.rate, num(r.taxable), num(r.cess)]),
  ]);

  // 6. cdnur ------------------------------------------------------------------------------------------------------------------
  const cdnurValue = num(rep.cdnur.reduce((n, r, i, a) => (a.findIndex((x) => x.docId === r.docId) === i ? n + r.value : n), 0));
  const cdnur = sheet("cdnur", W.wide as unknown as Widths, [
    ["Summary For CDNUR(9B)", ...blanks(12)],
    ["", "No. of Notes/Vouchers", "", "", "", "Total Note Value", "", "", "Total Taxable Value", "Total Cess"],
    ["", T.cdnur.notes, "", "", "", cdnurValue, "", "", num(T.cdnur.taxable), num(T.cdnur.cess), "", "", ""],
    ["UR Type", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"],
    ...rep.cdnur.map((r): Cell[] => [r.urType, r.number, fmtDateDMY(r.date), r.noteType, r.pos, num(r.value), "", r.rate, num(r.taxable), num(r.cess)]),
  ]);

  // 7. exp -------------------------------------------------------------------------------------------------------------------------
  const hasExp = rep.exp.length > 0;
  const exp = sheet("exp", [[1, 9, W.default]], [
    ["Summary For EXP(6)", ...blanks(8)],
    ["", "No. of Invoices", "", "Total Invoice Value", "", "No. of Shipping Bill", "", "", "Total Taxable Value"],
    hasExp ? ["", T.exp.invoices, "", num(T.exp.value), "", T.exp.shippingBills, "", "", num(T.exp.taxable)] : blanks(9),
    ["Export Type", "Invoice Number", "Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value"],
    ...rep.exp.map((r): Cell[] => [r.exportType, r.number, fmtDateDMY(r.date), num(r.value), r.portCode, r.shippingBillNumber, r.shippingBillDate ? fmtDateDMY(r.shippingBillDate) : "", r.rate, num(r.taxable)]),
  ]);

  // 8-9. at / atadj ------------------------------------------------------------------------------------------------------------------
  const advance = (name: string, title: string, totalLabel: string, grossLabel: string, rows: Gstr1Report["at"], total: { amount: number; cess: number }) =>
    sheet(name, [[1, 4, W.default]], [
      [title, ...blanks(4)],
      ["", "", "", totalLabel, "Total Cess"],
      rows.length ? ["", "", "", num(total.amount), num(total.cess)] : blanks(5),
      ["Place Of Supply", "Applicable % of Tax Rate", "Rate", grossLabel, "Cess Amount"],
      ...rows.map((r): Cell[] => [r.pos, "", r.rate, num(r.amount), num(r.cess)]),
    ]);
  const at = advance("at", "Summary For Advance Received(11B)", "Total Advance Received", "Gross Advance Received", rep.at, T.at);
  const atadj = advance("atadj", "Summary For Advance Adjusted(11B)", "Total Advance Adjusted", "Gross Advance Adjusted", rep.atadj, T.atadj);

  // 10. exemp -------------------------------------------------------------------------------------------------------------------------------
  const exemp = sheet("exemp", [[1, 1, 40.875], [2, 4, 25.875]], [
    ["Summary For Nil rated, exempted and non GST outward supplies (8)", "", "", ""],
    ["", "Total Nil Rated Supplies", "Total Exempted Supplies", "Total Non-GST Supplies"],
    ["", num(T.exemp.nil), num(T.exemp.exempted), num(T.exemp.nonGst)],
    ["Description", "Nil Rated Supplies", "Exempted(other than nil rated/non GST supply)", "Non-GST Supplies"],
    ...EXEMP_CATEGORIES.map((e): Cell[] => {
      const b = rep.exemp.find((x) => x.key === e.key)!;
      return [e.label, num(b.nil), num(b.exempted), num(b.nonGst)];
    }),
  ]);

  const sheets = [
    report, b2b, b2cl, b2cs, cdnr, cdnur, exp, at, atadj, exemp,
    hsnSheet("hsn(b2b)", rep.hsnB2b, false, rep.hsnTotals.b2b), hsnSheet("hsn(b2c)", rep.hsnB2c, false, rep.hsnTotals.b2c), hsnSheet("itemSummary", rep.items, true, rep.hsnTotals.items), docsSheet(rep.docs),
  ];
  return sheets;
}
