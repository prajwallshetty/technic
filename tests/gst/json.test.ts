/** GSTR-1 JSON builder and structural validation (synthetic documents). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGstr1Json } from "../../src/lib/gst/gstr1/json";
import { validateGstr1Json } from "../../src/lib/gst/gstr1/jsonSchema";
import { buildGstr1, periodFor } from "../../src/lib/gst/gstr1/report";
import type { GstDoc, GstLine, GstrInput } from "../../src/lib/gst/gstr1/types";

const CS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(state: string, seed: string) {
  const base = `${state}${seed.padEnd(5, "A").slice(0, 5)}1234F1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const p = CS.indexOf(base[i]) * (i % 2 ? 2 : 1); t += Math.floor(p / 36) + (p % 36); }
  return base + CS[(36 - (t % 36)) % 36];
}
const FIRM = gstin("29", "FIRMA"), BUYER = gstin("29", "BUYER");
const r2 = (n: number) => Math.round(n * 100) / 100;
const line = (n: number, taxable: number, rate: number, inter = false): GstLine => {
  const tax = r2((taxable * rate) / 100);
  return { lineNo: n, description: `ITEM ${n}`, hsn: "85071000", uqc: "pcs", quantity: 1, rate, cessRate: 0, taxability: "TAXABLE", taxable, cgst: inter ? 0 : r2(tax / 2), sgst: inter ? 0 : r2(tax / 2), igst: inter ? tax : 0, cess: 0, total: r2(taxable + tax) };
};
function doc(n: string, lines: GstLine[], o: Partial<GstDoc> = {}): GstDoc {
  const t = (k: "taxable" | "cgst" | "sgst" | "igst") => r2(lines.reduce((s, l) => s + l[k], 0));
  return { kind: "INVOICE", id: `i${n}`, number: n, date: "2026-09-10", status: "ISSUED", party: { name: "P", gstin: null, treatment: null }, supplyType: "REGULAR", placeOfSupplyName: null, placeOfSupplyCode: "29", reverseCharge: false, ecommerceGstin: null, exportDetails: null, original: null,
    totals: { subtotal: t("taxable"), discount: 0, taxable: t("taxable"), cgst: t("cgst"), sgst: t("sgst"), igst: t("igst"), cess: 0, roundOff: 0, total: r2(t("taxable") + t("cgst") + t("sgst") + t("igst")) }, lines, link: "/", ...o };
}
const build = (docs: GstDoc[], firm: Partial<GstrInput["firm"]> = {}) => buildGstr1({
  firm: { gstin: FIRM, legalName: "Firm", tradeName: null, stateCode: "29", aatoBand: "UPTO_5CR", previousFyTurnover: 5_000_000, currentFyTurnover: 2_000_000, ...firm },
  period: periodFor("2026-09-01", "2026-09-30"), docs, advances: [], adjustments: [], register: null, gstSummary: null, today: "2026-10-15",
});

describe("GSTR-1 JSON", () => {
  const docs = [
    doc("1", [line(1, 1000, 18), line(2, 500, 5)], { party: { name: "B", gstin: BUYER, treatment: null } }),
    doc("2", [line(1, 700, 18)]),
    doc("3", [line(1, 200, 18)]),
  ];

  it("produces a structurally valid payload with the expected sections and codes", () => {
    const { json, blockers } = buildGstr1Json(build(docs));
    assert.deepEqual(blockers, []);
    assert.ok(json);
    assert.equal(json!.fp, "092026");
    assert.equal((json!.b2b as any[])[0].inv[0].idt, "10-09-2026");
    assert.equal((json!.b2b as any[])[0].inv[0].pos, "29");
    assert.equal((json!.b2b as any[])[0].inv[0].inv_typ, "R");
    assert.equal((json!.b2b as any[])[0].inv[0].itms.length, 2);
    assert.deepEqual((json!.b2cs as any[])[0], { sply_ty: "INTRA", rt: 18, typ: "OE", pos: "29", txval: 900, iamt: 0, camt: 81, samt: 81, csamt: 0 });
    assert.deepEqual((json!.hsn as any).hsn_b2c[0].uqc, "PCS");
    assert.deepEqual((json!.doc_issue as any).doc_det[0], { doc_num: 1, doc_typ: "Invoices for outward supply", docs: [{ num: 1, from: "1", to: "3", totnum: 3, cancel: 0, net_issue: 3 }] });
    const v = validateGstr1Json(json);
    assert.deepEqual(v.errors, []);
    assert.equal(v.checkedAgainst.official, false);
    assert.match(v.caveat, /NOT the official portal schema/);
  });

  it("refuses to produce JSON while anything blocking is outstanding — it never guesses", () => {
    const missingPos = doc("9", [line(1, 100, 18)], { placeOfSupplyCode: null, party: { name: "B", gstin: BUYER, treatment: null } });
    const { json, blockers } = buildGstr1Json(build([missingPos]));
    assert.equal(json, null);
    assert.ok(blockers.some((b) => /place of supply/i.test(b)));
  });

  it("needs the turnover figures the portal asks for", () => {
    const { json, blockers } = buildGstr1Json(build(docs, { previousFyTurnover: null, currentFyTurnover: null }));
    assert.equal(json, null);
    assert.ok(blockers.some((b) => /turnover/i.test(b)));
    assert.ok(blockers.some((b) => /cur_gt/.test(b)));
  });

  it("the validator rejects broken payloads and says what is wrong", () => {
    const { json } = buildGstr1Json(build(docs));
    const broken = JSON.parse(JSON.stringify(json));
    broken.b2b[0].inv[0].idt = "2026-09-10";
    broken.b2b[0].inv[0].itms[0].itm_det.rt = 13;
    broken.fp = "132026";
    broken.doc_issue.doc_det[0].docs[0].net_issue = 99;
    const v = validateGstr1Json(broken);
    assert.equal(v.ok, false);
    const text = v.errors.join("\n");
    assert.match(text, /idt/);
    assert.match(text, /rt/);
    assert.match(text, /fp/);
    assert.match(text, /net_issue/);
  });

  it("an official schema, when supplied, is applied as well and reported as such", () => {
    const { json } = buildGstr1Json(build(docs));
    const strictOfficial = { type: "object", required: ["definitely_required_field"] };
    const v = validateGstr1Json(json, strictOfficial);
    assert.equal(v.checkedAgainst.official, true);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.startsWith("official schema")));
  });
});
