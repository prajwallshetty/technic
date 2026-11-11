/**
 * Layout fidelity against the Vyapar reference workbook
 * (data/gstr1-reference/vyapar-gstr1-september-2026.xlsx — confidential, not in
 * git, so the suite skips when it is absent).
 *
 * The reference is read, turned back into a Gstr1Report, rendered by our own
 * sheet models + ExcelJS writer, read back, and compared with the reference
 * cell by cell: values, text-vs-number types, positions, column widths and row
 * heights. Only the reference's STRUCTURE is used; no reference data is kept.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import ExcelJS from "exceljs";

import { SHEET_NAMES, toSheetModels } from "../../src/lib/gst/gstr1/sheets";
import { writeWorkbook } from "../../src/lib/gst/gstr1/excel";
import type { Gstr1Report } from "../../src/lib/gst/gstr1/types";

const REF = "data/gstr1-reference/vyapar-gstr1-september-2026.xlsx";
const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const iso = (s: unknown) => {
  const t = String(s ?? "");
  let m = t.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) return `${m[3]}-${MON[m[2]]}-${m[1]}`;
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

type Grid = Map<number, unknown[]>;
async function readGrid(path: string | Buffer) {
  const wb = new ExcelJS.Workbook();
  if (typeof path === "string") await wb.xlsx.readFile(path); else await wb.xlsx.load(path as never);
  const sheets = new Map<string, { grid: Grid; ws: ExcelJS.Worksheet }>();
  wb.eachSheet((ws) => {
    const grid: Grid = new Map();
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const cells: unknown[] = [];
      row.eachCell({ includeEmpty: false }, (cell, c) => { cells[c - 1] = cell.value; });
      grid.set(r, cells);
    });
    sheets.set(ws.name, { grid, ws });
  });
  return { wb, sheets };
}

/** Rebuilds a Gstr1Report from the reference's rows so our writer can re-render them. */
function reportFrom(sheets: Map<string, { grid: Grid }>): Gstr1Report {
  const g = (name: string) => sheets.get(name)!.grid;
  const body = (name: string, from: number) => [...g(name)].filter(([r]) => r >= from).map(([, c]) => c);
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const rep = g("GSTR1 Report");
  const totalRowNo = Math.max(...rep.keys());
  const tr = rep.get(totalRowNo)!;
  const hsn = (name: string, items: boolean) => body(name, 5).map((c) => ({ hsn: s(c[0]), description: items ? s(c[1]) : "", uqc: s(c[2]), quantity: n(c[3]), value: n(c[4]), rate: n(c[5]), taxable: n(c[6]), igst: n(c[7]), cgst: n(c[8]), sgst: n(c[9]), cess: n(c[10]) }));
  const adv = (name: string) => body(name, 5).map((c) => ({ pos: s(c[0]), rate: n(c[2]), amount: n(c[3]), cess: n(c[4]), igst: 0, cgst: 0, sgst: 0 }));
  const ex = g("exemp");
  const exRows = (["INTER_REG", "INTRA_REG", "INTER_UNREG", "INTRA_UNREG"] as const).map((key, i) => { const c = ex.get(5 + i)!; return { key, nil: n(c[1]), exempted: n(c[2]), nonGst: n(c[3]) }; });
  const b2bSum = g("b2b,sez,de").get(3)!, b2clSum = g("b2cl").get(3)!, b2csSum = g("b2cs").get(3)!, cdnrSum = g("cdnr").get(3)!, cdnurSum = g("cdnur").get(3)!;
  const hs = (name: string) => { const c = g(name).get(3)!; return { value: n(c[4]), taxable: n(c[6]), igst: n(c[7]), cgst: n(c[8]), sgst: n(c[9]), cess: n(c[10]) }; };
  return {
    firm: { gstin: s(g("GSTR1 Report").get(3)![1]), legalName: s(g("GSTR1 Report").get(4)![1]), tradeName: null, stateCode: "29", aatoBand: null, previousFyTurnover: null, currentFyTurnover: null },
    period: { from: "2026-09-01", to: "2026-09-30", label: s(g("GSTR1 Report").get(1)![1]), fp: "092026" },
    rows: [...rep].filter(([r]) => r >= 11 && r < totalRowNo - 1).map(([, c]) => ({
      gstin: s(c[0]), partyName: s(c[1]), txnType: s(c[2]) as "Sale", number: s(c[3]), date: iso(c[4]), value: n(c[5]), rate: n(c[6]), cessRate: n(c[7]), taxable: n(c[8]),
      reverseCharge: s(c[9]) as "N", igst: n(c[10]), cgst: n(c[11]), sgst: n(c[12]), cess: n(c[13]), posName: s(c[14]), docId: s(c[3]),
    })),
    b2b: body("b2b,sez,de", 5).map((c) => ({ gstin: s(c[0]), name: s(c[1]), number: s(c[2]), date: iso(c[3]), value: n(c[4]), pos: s(c[5]), reverseCharge: s(c[6]) as "N", applicablePct: null, invoiceType: s(c[8]), ecommerceGstin: s(c[9]), rate: n(c[10]), taxable: n(c[11]), cess: n(c[12]), igst: 0, cgst: 0, sgst: 0, supplyType: "REGULAR" as const, docId: s(c[2]) })),
    b2cl: [],
    b2cs: body("b2cs", 5).map((c) => ({ type: s(c[0]) as "OE", pos: s(c[1]), rate: n(c[3]), taxable: n(c[4]), cess: n(c[5]), igst: 0, cgst: 0, sgst: 0, ecommerceGstin: s(c[6]) })),
    cdnr: body("cdnr", 5).map((c) => ({ gstin: s(c[0]), name: s(c[1]), number: s(c[2]), date: iso(c[3]), noteType: s(c[4]) as "C", pos: s(c[5]), reverseCharge: s(c[6]) as "N", supplyType: s(c[7]), value: n(c[8]), rate: n(c[10]), taxable: n(c[11]), cess: n(c[12]), igst: 0, cgst: 0, sgst: 0, invoiceType: "REGULAR" as const, originalNumber: null, originalDate: null, docId: s(c[2]) })),
    cdnur: [], exp: [], at: adv("at"), atadj: adv("atadj"), exemp: exRows,
    hsnB2b: hsn("hsn(b2b)", false), hsnB2c: hsn("hsn(b2c)", false), items: hsn("itemSummary", true),
    hsnTotals: { b2b: hs("hsn(b2b)"), b2c: hs("hsn(b2c)"), items: hs("itemSummary") },
    docs: body("docs", 5).map((c) => ({ nature: s(c[0]) as "Credit Note", from: s(c[1]), to: s(c[2]), total: Number(c[3]), cancelled: Number(c[4]), missing: [] })),
    issues: [], reconciliation: [],
    totals: {
      invoiceCount: 0, noteCount: 0, cancelledCount: 0,
      b2b: { recipients: n(b2bSum[0]), invoices: n(b2bSum[2]), value: n(b2bSum[4]), taxable: n(b2bSum[11]), cess: n(b2bSum[12]) },
      b2cl: { invoices: n(b2clSum[0]), value: n(b2clSum[2]), taxable: n(b2clSum[6]), cess: n(b2clSum[7]) },
      b2cs: { taxable: n(b2csSum[4]), cess: n(b2csSum[5]) },
      cdnr: { recipients: n(cdnrSum[0]), notes: n(cdnrSum[2]), value: n(cdnrSum[8]), taxable: n(cdnrSum[11]), cess: n(cdnrSum[12]) },
      cdnur: { notes: n(cdnurSum[1]), value: n(cdnurSum[5]), taxable: n(cdnurSum[8]), cess: n(cdnurSum[9]) },
      exp: { invoices: 0, value: 0, taxable: 0, shippingBills: 0 }, at: { amount: 0, cess: 0 }, atadj: { amount: 0, cess: 0 },
      exemp: { nil: 0, exempted: 0, nonGst: 0 },
      net: { value: n(tr[5]), taxable: n(tr[8]), igst: n(tr[10]), cgst: n(tr[11]), sgst: n(tr[12]), cess: n(tr[13]) },
    },
    rulesApplied: { b2clThreshold: 100000, hsnMinDigits: 4, hsnSplit: true },
  };
}

const norm = (v: unknown) => (v === undefined || v === null || v === "" ? "" : v);

describe("GSTR-1 workbook layout vs the Vyapar reference", { skip: !fs.existsSync(REF) && "reference workbook not present" }, () => {
  let refSheets: Awaited<ReturnType<typeof readGrid>>["sheets"];
  let outSheets: Awaited<ReturnType<typeof readGrid>>["sheets"];

  it("renders the reference's own data back into a workbook", async () => {
    refSheets = (await readGrid(REF)).sheets;
    const models = toSheetModels(reportFrom(refSheets));
    const buffer = Buffer.from(await writeWorkbook(models).xlsx.writeBuffer());
    outSheets = (await readGrid(buffer)).sheets;
    assert.ok(buffer.length > 4000);
  });

  it("has the same 14 sheets in the same order, with the same names", () => {
    assert.deepEqual([...outSheets.keys()], [...refSheets.keys()]);
    assert.deepEqual([...outSheets.keys()], [...SHEET_NAMES]);
  });

  for (const name of SHEET_NAMES) {
    it(`sheet "${name}": every cell matches in position, type and value`, () => {
      const ref = refSheets.get(name)!, out = outSheets.get(name)!;
      assert.deepEqual([...out.grid.keys()], [...ref.grid.keys()], "same populated rows");
      for (const [r, refCells] of ref.grid) {
        const outCells = out.grid.get(r)!;
        const width = Math.max(refCells.length, outCells.length);
        for (let c = 0; c < width; c++) {
          const a = norm(refCells[c]), b = norm(outCells[c]);
          assert.equal(typeof b, typeof a, `${name} ${String.fromCharCode(65 + c)}${r}: type of ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
          assert.equal(b, a, `${name} ${String.fromCharCode(65 + c)}${r}`);
        }
      }
    });

    it(`sheet "${name}": column widths and row heights match`, () => {
      const ref = refSheets.get(name)!.ws, out = outSheets.get(name)!.ws;
      for (let c = 1; c <= 21; c++) {
        const a = ref.getColumn(c).width, b = out.getColumn(c).width;
        assert.ok(a === b || (Math.abs((a ?? 0) - (b ?? 0)) < 0.01), `${name} column ${c}: ${a} vs ${b}`);
      }
      ref.eachRow((row, r) => assert.equal(out.getRow(r).height, row.height, `${name} row ${r} height`));
    });
  }
});
