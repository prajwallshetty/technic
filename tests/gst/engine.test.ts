/** GSTR-1 engine: classification, calculations, validation and reconciliation (synthetic documents). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGstr1, periodFor } from "../../src/lib/gst/gstr1/report";
import type { GstDoc, GstLine, GstrInput, Gstr1Report, Issue } from "../../src/lib/gst/gstr1/types";
import { checkGstin } from "../../src/lib/gst/gstr1/util";

const CS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A structurally valid GSTIN with the correct check digit. */
function gstin(state: string, seed: string) {
  const base = `${state}${seed.padEnd(5, "A").slice(0, 5)}1234F1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const p = CS.indexOf(base[i]) * (i % 2 ? 2 : 1); t += Math.floor(p / 36) + (p % 36); }
  return base + CS[(36 - (t % 36)) % 36];
}
const FIRM = gstin("29", "FIRMA");
const KA = gstin("29", "BUYER"), TN = gstin("33", "TNBUY"), SEZ = gstin("29", "SEZUN");

const r2 = (n: number) => Math.round(n * 100) / 100;
function line(n: number, taxable: number, rate: number, o: Partial<GstLine> & { inter?: boolean } = {}): GstLine {
  const tax = r2((taxable * rate) / 100);
  const inter = o.inter ?? false;
  return {
    lineNo: n, description: o.description ?? `ITEM ${n}`, hsn: o.hsn === undefined ? "85071000" : o.hsn, uqc: o.uqc === undefined ? "pcs" : o.uqc, quantity: o.quantity ?? 1,
    rate: o.rate === undefined ? rate : o.rate, cessRate: 0, taxability: o.taxability ?? "TAXABLE", taxable,
    cgst: inter ? 0 : r2(tax / 2), sgst: inter ? 0 : r2(tax / 2), igst: inter ? tax : 0, cess: 0, total: r2(taxable + tax),
  };
}
function doc(o: { n: string; date?: string; kind?: GstDoc["kind"]; gstin?: string | null; pos?: string | null; lines: GstLine[]; status?: GstDoc["status"]; supply?: GstDoc["supplyType"]; roundOff?: number; name?: string }): GstDoc {
  const taxable = r2(o.lines.reduce((n, l) => n + l.taxable, 0));
  const cgst = r2(o.lines.reduce((n, l) => n + l.cgst, 0)), sgst = r2(o.lines.reduce((n, l) => n + l.sgst, 0)), igst = r2(o.lines.reduce((n, l) => n + l.igst, 0));
  const roundOff = o.roundOff ?? 0;
  return {
    kind: o.kind ?? "INVOICE", id: `id-${o.kind ?? "INV"}-${o.n}`, number: o.n, date: o.date ?? "2026-09-10", status: o.status ?? "ISSUED",
    party: { name: o.name ?? `Party ${o.n}`, gstin: o.gstin === undefined ? null : o.gstin, treatment: null }, supplyType: o.supply ?? "REGULAR",
    placeOfSupplyName: null, placeOfSupplyCode: o.pos === undefined ? "29" : o.pos, reverseCharge: false, ecommerceGstin: null, exportDetails: null,
    original: o.kind && o.kind !== "INVOICE" ? { number: "100", date: "2026-08-01", foundInErp: true } : null,
    totals: { subtotal: taxable, discount: 0, taxable, cgst, sgst, igst, cess: 0, roundOff, total: r2(taxable + cgst + sgst + igst + roundOff) },
    lines: o.lines, link: `/invoices/${o.n}`,
  };
}
function run(docs: GstDoc[], extra: Partial<GstrInput> = {}): Gstr1Report {
  const input: GstrInput = {
    firm: { gstin: FIRM, legalName: "Test Firm", tradeName: null, stateCode: "29", aatoBand: "UPTO_5CR", previousFyTurnover: 1000000, currentFyTurnover: null },
    period: periodFor("2026-09-01", "2026-09-30"), docs, advances: [], adjustments: [], register: null, gstSummary: null, today: "2026-10-15", ...extra,
  };
  return buildGstr1(input);
}
const codes = (r: Gstr1Report, c: string) => r.issues.filter((i: Issue) => i.code === c);

describe("classification", () => {
  it("B2B: registered buyer, one row per rate, invoice value not repeated in the register view", () => {
    const r = run([doc({ n: "1", gstin: KA, lines: [line(1, 1000, 18), line(2, 500, 5), line(3, 200, 18)] })]);
    assert.equal(r.b2b.length, 2); // 18% and 5%
    assert.deepEqual(r.b2b.map((x) => [x.rate, x.taxable]), [[5, 500], [18, 1200]]);
    assert.ok(r.b2b.every((x) => x.invoiceType === "Regular B2B" && x.pos === "29-Karnataka" && x.value === 1700 + 216 + 25));
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].value, 1941);
    assert.equal(r.rows[1].value, 0, "continuation row carries no invoice value (so the column totals correctly)");
    assert.equal(r.totals.net.value, 1941);
  });

  it("B2CS: unregistered intra-state sales are summarised by place of supply and rate", () => {
    const r = run([doc({ n: "1", lines: [line(1, 1000, 18)] }), doc({ n: "2", lines: [line(1, 500, 18)] }), doc({ n: "3", lines: [line(1, 100, 5)] })]);
    assert.deepEqual(r.b2cs.map((x) => [x.type, x.pos, x.rate, x.taxable]), [["OE", "29-Karnataka", 5, 100], ["OE", "29-Karnataka", 18, 1500]]);
    assert.equal(r.b2b.length + r.b2cl.length, 0);
  });

  it("B2CL: inter-state unregistered above the period's limit; the limit depends on the tax period", () => {
    const big = doc({ n: "1", pos: "33", lines: [line(1, 127000, 18, { inter: true })] }); // value 149,860
    const sep2026 = run([big]);
    assert.equal(sep2026.rulesApplied.b2clThreshold, 100000);
    assert.equal(sep2026.b2cl.length, 1);
    const jul2024 = run([{ ...big, date: "2024-07-10" }], { period: periodFor("2024-07-01", "2024-07-31") });
    assert.equal(jul2024.rulesApplied.b2clThreshold, 250000);
    assert.equal(jul2024.b2cl.length, 0);
    assert.equal(jul2024.b2cs.length, 1, "below the older ₹2.5 lakh limit it is a B2CS supply");
    const exactly = run([doc({ n: "2", pos: "33", lines: [line(1, 84745.76, 18, { inter: true })] })]);
    assert.ok(exactly.totals.b2cl.invoices + exactly.b2cs.length >= 1);
  });

  it("exports go to exp with WPAY/WOPAY and keep shipping-bill details", () => {
    const d = doc({ n: "1", pos: "96", supply: "EXPORT_WITH_PAYMENT", lines: [line(1, 10000, 18, { inter: true })] });
    d.exportDetails = { portCode: "INMAA1", shippingBillNumber: "123456", shippingBillDate: "2026-09-12" };
    const r = run([d]);
    assert.equal(r.exp.length, 1);
    assert.deepEqual([r.exp[0].exportType, r.exp[0].portCode, r.exp[0].shippingBillNumber, r.exp[0].igst], ["WPAY", "INMAA1", "123456", 1800]);
    assert.equal(r.b2b.length + r.b2cs.length, 0);
    assert.equal(codes(r, "EXPORT_DETAILS_MISSING").length, 0);
  });

  it("SEZ and deemed exports are reported on the b2b sheet with their invoice type", () => {
    const r = run([doc({ n: "1", gstin: SEZ, supply: "SEZ_WITH_PAYMENT", lines: [line(1, 1000, 18, { inter: true })] }), doc({ n: "2", gstin: SEZ, supply: "SEZ_WITHOUT_PAYMENT", lines: [{ ...line(1, 1000, 18), cgst: 0, sgst: 0, igst: 0 }] })]);
    assert.deepEqual(r.b2b.map((x) => x.invoiceType), ["SEZ supplies with payment", "SEZ supplies without payment"]);
  });

  it("credit notes: registered → cdnr; small unregistered → reduce b2cs; both net off HSN and the totals", () => {
    const inv = doc({ n: "1", gstin: KA, lines: [line(1, 1000, 18, { quantity: 10, description: "WIDGET" })] });
    const cnReg = doc({ n: "5", kind: "CREDIT_NOTE", gstin: KA, lines: [line(1, 200, 18, { quantity: 2, description: "WIDGET" })] });
    const inv2 = doc({ n: "2", lines: [line(1, 1000, 18, { hsn: "85072000", quantity: 4 })] });
    const cnUnreg = doc({ n: "6", kind: "CREDIT_NOTE", lines: [line(1, 100, 18, { hsn: "85072000", quantity: 1 })] });
    const r = run([inv, cnReg, inv2, cnUnreg]);
    assert.equal(r.cdnr.length, 1);
    assert.deepEqual([r.cdnr[0].noteType, r.cdnr[0].taxable, r.cdnr[0].value], ["C", 200, 236]);
    assert.equal(r.b2cs[0].taxable, 900, "unregistered credit note reduces the B2CS summary");
    assert.equal(r.hsnB2b[0].quantity, 8);
    assert.equal(r.hsnB2b[0].taxable, 800);
    assert.equal(r.hsnB2c[0].quantity, 3);
    assert.equal(r.totals.net.taxable, 1000 + 1000 - 200 - 100);
    assert.equal(r.rows.find((x) => x.txnType === "Credit Note")!.value, 236, "notes keep a positive value in the register view");
  });

  it("nil-rated / exempt / non-GST lines go to table 8, by category, not to the rate tables", () => {
    const r = run([
      doc({ n: "1", gstin: KA, lines: [line(1, 1000, 18), line(2, 300, 0, { taxability: "NIL_RATED", rate: 0 })] }),
      doc({ n: "2", lines: [line(1, 150, 0, { taxability: "EXEMPTED", rate: 0 })] }),
      doc({ n: "3", pos: "33", lines: [line(1, 80, 0, { taxability: "NON_GST", rate: 0, inter: true })] }),
    ]);
    const by = Object.fromEntries(r.exemp.map((e) => [e.key, e]));
    assert.equal(by.INTRA_REG.nil, 300);
    assert.equal(by.INTRA_UNREG.exempted, 150);
    assert.equal(by.INTER_UNREG.nonGst, 80);
    assert.deepEqual(r.b2b.map((x) => x.taxable), [1000]);
    assert.equal(r.docs[0].total, 3);
  });

  it("cancelled documents appear only in table 13", () => {
    const r = run([doc({ n: "1", lines: [line(1, 1000, 18)] }), doc({ n: "2", status: "CANCELLED", lines: [line(1, 999, 18)] })]);
    assert.equal(r.b2cs[0].taxable, 1000);
    assert.deepEqual([r.docs[0].from, r.docs[0].to, r.docs[0].total, r.docs[0].cancelled], ["1", "2", 2, 1]);
    assert.equal(r.totals.cancelledCount, 1);
  });

  it("advances: received (11A) and adjusted (11B) are summarised by place of supply and rate", () => {
    const adv = { id: "a1", number: "ADV1", date: "2026-09-05", status: "RECEIVED" as const, placeOfSupplyCode: "29", placeOfSupplyName: null, rate: 18, cessRate: 0, grossAmount: 11800, link: "/x" };
    const r = run([], { advances: [adv, { ...adv, id: "a2", number: "ADV2", date: "2026-08-20" }], adjustments: [{ advanceId: "a2", invoiceId: "i", amount: 5900, date: "2026-09-15" }] });
    assert.deepEqual(r.at.map((x) => [x.pos, x.rate, x.amount, x.cgst, x.sgst]), [["29-Karnataka", 18, 11800, 900, 900]]);
    assert.deepEqual(r.atadj.map((x) => [x.amount, x.cgst]), [[5900, 450]]);
  });
});

describe("table 13 (documents issued)", () => {
  it("one continuous range per series, with the numbers missing from it reported", () => {
    const r = run([1, 2, 3, 6, 7].map((n) => doc({ n: String(n), lines: [line(1, 100, 18)] })));
    assert.deepEqual([r.docs[0].from, r.docs[0].to, r.docs[0].total, r.docs[0].missing], ["1", "7", 5, ["4", "5"]]);
    const gap = codes(r, "SERIES_GAP");
    assert.equal(gap.length, 1);
    assert.equal(gap[0].blocking, true);
  });
  it("separate numbering prefixes are separate series", () => {
    const r = run([doc({ n: "A/001", lines: [line(1, 1, 18)] }), doc({ n: "A/002", lines: [line(1, 1, 18)] }), doc({ n: "B/001", lines: [line(1, 1, 18)] })]);
    assert.equal(r.docs.length, 2);
  });
});

describe("validation", () => {
  it("flags missing GSTIN, invalid GSTIN check digit, missing/invalid POS, missing HSN and UQC", () => {
    const badGstin = KA.slice(0, 14) + (KA[14] === "A" ? "B" : "A");
    assert.notEqual(checkGstin(badGstin), "OK");
    const r = run([
      doc({ n: "1", gstin: badGstin, lines: [line(1, 100, 18)] }),
      doc({ n: "2", gstin: KA, pos: null, lines: [line(1, 100, 18)] }),
      doc({ n: "3", gstin: KA, lines: [line(1, 100, 18, { hsn: null }), line(2, 50, 18, { uqc: "banana" })] }),
    ]);
    assert.equal(codes(r, "GSTIN_INVALID").length, 1);
    assert.equal(codes(r, "POS_MISSING").length, 1);
    assert.equal(codes(r, "HSN_MISSING").length, 1);
    assert.equal(codes(r, "UQC_INVALID").length, 1);
    assert.ok(codes(r, "GSTIN_INVALID")[0].blocking);
    assert.equal(codes(r, "POS_MISSING")[0].docNumber, "2");
    assert.equal(r.b2b.find((x) => x.number === "2")!.pos, "", "a missing place of supply stays blank, never defaulted");
  });

  it("flags a tax type that contradicts the place of supply, and a calculation mismatch", () => {
    const wrongTax = doc({ n: "1", gstin: TN, pos: "33", lines: [line(1, 1000, 18)] }); // CGST/SGST to another state
    const intraIgst = doc({ n: "2", gstin: KA, lines: [line(1, 1000, 18, { inter: true })] }); // IGST within the state
    const miscalc = doc({ n: "3", gstin: KA, lines: [{ ...line(1, 1000, 18), cgst: 100, sgst: 100 }] });
    const r = run([wrongTax, intraIgst, miscalc]);
    assert.equal(codes(r, "TAX_TYPE_MISMATCH").length, 2);
    assert.ok(codes(r, "TAX_CALC_MISMATCH").length >= 1);
  });

  it("flags header totals that disagree with the lines, duplicate numbers and bad rates", () => {
    const d1 = doc({ n: "1", gstin: KA, lines: [line(1, 1000, 18)] });
    d1.totals = { ...d1.totals, taxable: 900 };
    const r = run([d1, doc({ n: "2", gstin: KA, lines: [line(1, 10, 18)] }), doc({ n: "2", gstin: KA, lines: [line(1, 10, 18)] }), doc({ n: "3", gstin: KA, lines: [line(1, 100, 13, { rate: 13 })] })]);
    assert.ok(codes(r, "HEADER_LINES_MISMATCH").length >= 1);
    assert.equal(codes(r, "DUPLICATE_NUMBER").length, 1);
    assert.equal(codes(r, "RATE_INVALID").length, 1);
  });

  it("a one-paisa rounding difference on a negative (discount) line is not a calculation error", () => {
    const discount = { ...line(1, -21333.05, 18), cgst: -1919.97, sgst: -1919.98 }; // 18% of -21333.05 = -3839.949
    const r = run([doc({ n: "1", gstin: KA, lines: [line(1, 57627.12, 18), discount] })]);
    assert.equal(codes(r, "TAX_CALC_MISMATCH").length, 0);
  });

  it("0% on a taxable line is a warning to classify it, not silently treated as nil-rated", () => {
    const r = run([doc({ n: "1", gstin: KA, lines: [line(1, 500, 0, { rate: 0 })] })]);
    assert.equal(codes(r, "ZERO_RATE_TAXABLE").length, 1);
    assert.equal(r.exemp.reduce((n, e) => n + e.nil + e.exempted + e.nonGst, 0), 0);
  });

  it("credit notes need a valid reference and cannot pre-date the invoice", () => {
    const early = doc({ n: "1", kind: "CREDIT_NOTE", gstin: KA, date: "2026-07-01", lines: [line(1, 10, 18)] });
    const noRef = doc({ n: "2", kind: "CREDIT_NOTE", gstin: KA, lines: [line(1, 10, 18)] });
    noRef.original = null;
    const r = run([early, noRef]);
    assert.equal(codes(r, "NOTE_BEFORE_INVOICE").length, 1);
    assert.equal(codes(r, "NOTE_REFERENCE_MISSING").length, 1);
  });

  it("turnover and the AATO band are warnings that only block the portal JSON", () => {
    const r = run([doc({ n: "1", lines: [line(1, 100, 18)] })], { firm: { gstin: FIRM, legalName: null, tradeName: null, stateCode: "29", aatoBand: null, previousFyTurnover: null, currentFyTurnover: null } });
    const t = codes(r, "TURNOVER_NOT_CONFIGURED")[0];
    assert.equal(t.jsonOnly, true);
    assert.equal(codes(r, "AATO_BAND_NOT_CONFIGURED").length, 1);
    assert.equal(codes(r, "FIRM_LEGAL_NAME_MISSING").length, 1);
  });

  it("a custom multi-month range blocks the JSON only", () => {
    const r = run([], { period: periodFor("2026-08-01", "2026-09-30") });
    assert.equal(codes(r, "PERIOD_NOT_A_MONTH")[0].jsonOnly, true);
  });

  it("does not modify its input", () => {
    const d = doc({ n: "1", gstin: KA, lines: [line(1, 1000, 18)] });
    const before = JSON.stringify(d);
    run([d]);
    assert.equal(JSON.stringify(d), before);
  });
});

describe("reconciliation", () => {
  const reg = (docs: GstDoc[]) => {
    const t = (list: GstDoc[]) => ({ count: list.length, total: r2(list.reduce((n, d) => n + d.totals.total, 0)), taxable: r2(list.reduce((n, d) => n + d.totals.taxable, 0)), cgst: r2(list.reduce((n, d) => n + d.totals.cgst, 0)), sgst: r2(list.reduce((n, d) => n + d.totals.sgst, 0)), igst: r2(list.reduce((n, d) => n + d.totals.igst, 0)), cess: 0 });
    return { invoices: t(docs.filter((d) => d.kind === "INVOICE" && d.status === "ISSUED")), creditNotes: t(docs.filter((d) => d.kind === "CREDIT_NOTE")), debitNotes: t(docs.filter((d) => d.kind === "DEBIT_NOTE")) };
  };
  const docs = () => [
    doc({ n: "1", gstin: KA, lines: [line(1, 1000, 18), line(2, 300, 5)] }),
    doc({ n: "2", lines: [line(1, 700, 18)] }),
    doc({ n: "3", pos: "33", lines: [line(1, 90000, 18, { inter: true })] }),
    doc({ n: "9", kind: "CREDIT_NOTE", gstin: KA, lines: [line(1, 100, 18)] }),
    doc({ n: "4", lines: [line(1, 200, 0, { taxability: "NIL_RATED", rate: 0 })] }),
  ];

  it("every figure ties out when the documents are consistent", () => {
    const d = docs();
    const gstSummary = { taxable: 1000 + 300 + 700 + 90000 + 200, cgst: 90 + 7.5 + 63, sgst: 90 + 7.5 + 63, igst: 16200 };
    const r = run(d, { register: reg(d), gstSummary: { taxable: gstSummary.taxable - 100, cgst: gstSummary.cgst - 9, sgst: gstSummary.sgst - 9, igst: gstSummary.igst } });
    const bad = r.reconciliation.filter((x) => x.ok === false);
    assert.deepEqual(bad.map((x) => x.key), [], JSON.stringify(bad));
    assert.ok(r.reconciliation.filter((x) => x.ok === true).length >= 14);
  });

  it("shows — never absorbs — a difference against the register", () => {
    const d = docs();
    const tampered = reg(d);
    tampered.invoices.taxable += 250;
    const r = run(d, { register: tampered });
    const line = r.reconciliation.find((x) => x.key === "taxable")!;
    assert.equal(line.ok, false);
    assert.equal(line.difference, -250);
    assert.ok(r.issues.some((i) => i.code === "RECONCILIATION_DIFFERENCE" && i.blocking));
  });

  it("an invoice that cannot be placed in any table is a coverage difference", () => {
    const d = docs();
    const r = run(d, { register: reg(d) });
    const cov = r.reconciliation.find((x) => x.key === "coverage")!;
    assert.equal(cov.ok, true);
  });
});
