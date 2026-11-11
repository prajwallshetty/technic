import { DOC_NATURES, JSON_INVOICE_TYPE, EXEMP_CATEGORIES, fmtDateJson, stateCodeFromGstin } from "./masters";
import type { B2bRow, CdnrRow, ExpRow, Gstr1Report, HsnRow } from "./types";
import { r2 } from "./util";

/**
 * Builds the GSTR-1 JSON for upload on the GST portal, from a validated report.
 *
 * The structure follows the GSTN GSTR-1 "save" payload (b2b, b2cl, b2cs, cdnr,
 * cdnur, exp, at, txpd, nil, hsn, doc_issue) with the offline tool 3.2.4 date
 * and code conventions. See jsonSchema.ts for how it is checked, and for what
 * has NOT been verified against the official schema file.
 *
 * The builder refuses to produce JSON while anything blocking is outstanding —
 * a payload with guessed values would be worse than none.
 */
export const OFFLINE_TOOL_VERSION = "GST3.2.4";

export interface JsonResult {
  json: Record<string, unknown> | null;
  /** Reasons the JSON could not be produced (empty when `json` is set). */
  blockers: string[];
}

const uqcCode = (uqc: string) => uqc.split("-")[0];
const n2 = (n: number) => r2(n);

export function buildGstr1Json(rep: Gstr1Report): JsonResult {
  const blockers: string[] = [];
  const blocking = rep.issues.filter((i) => i.blocking);
  for (const i of blocking) blockers.push(`${i.docNumber ? `[${i.docNumber}] ` : ""}${i.message}`);
  if (rep.firm.previousFyTurnover === null) { /* already a blocking jsonOnly issue */ }
  if (rep.firm.currentFyTurnover === null) blockers.push("Cumulative turnover of the current financial year (cur_gt) is not configured (setting gst_turnover_cur_fy).");
  if (blockers.length) return { json: null, blockers };

  const supplier = rep.firm.stateCode ?? stateCodeFromGstin(rep.firm.gstin);
  const posCode = (label: string) => label.slice(0, 2);
  const group = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const itms = (rows: { rate: number; taxable: number; igst: number; cess: number; cgst?: number; sgst?: number }[], withCs: boolean) =>
    rows.map((r, i) => ({
      num: i + 1,
      itm_det: {
        rt: r.rate, txval: n2(r.taxable), iamt: n2(r.igst),
        ...(withCs ? { camt: n2(r.cgst ?? 0), samt: n2(r.sgst ?? 0) } : {}), csamt: n2(r.cess),
      },
    }));

  // b2b ------------------------------------------------------------------------------------------------
  const invoicesOf = <R extends { number: string; docId: string }>(rows: R[]) => group(rows, (r) => r.docId);
  const b2b = [...group(rep.b2b, (r) => r.gstin)].map(([ctin, rows]) => ({
    ctin,
    inv: [...invoicesOf<B2bRow>(rows)].map(([, lines]) => {
      const f = lines[0];
      return {
        inum: f.number, idt: fmtDateJson(f.date), val: n2(f.value), pos: posCode(f.pos), rchrg: f.reverseCharge,
        ...(f.ecommerceGstin ? { etin: f.ecommerceGstin } : {}),
        inv_typ: JSON_INVOICE_TYPE[f.supplyType as keyof typeof JSON_INVOICE_TYPE] ?? "R",
        itms: itms(lines, true),
      };
    }),
  }));

  // b2cl ----------------------------------------------------------------------------------------------------
  const b2cl = [...group(rep.b2cl, (r) => r.pos)].map(([pos, rows]) => ({
    pos: posCode(pos),
    inv: [...invoicesOf(rows)].map(([, lines]) => ({
      inum: lines[0].number, idt: fmtDateJson(lines[0].date), val: n2(lines[0].value),
      ...(lines[0].ecommerceGstin ? { etin: lines[0].ecommerceGstin } : {}),
      itms: itms(lines, false).map((x) => ({ num: x.num, itm_det: { rt: x.itm_det.rt, txval: x.itm_det.txval, iamt: x.itm_det.iamt, csamt: x.itm_det.csamt } })),
    })),
  }));

  // b2cs ------------------------------------------------------------------------------------------------------
  const b2cs = rep.b2cs.filter((r) => r.taxable !== 0 || r.igst !== 0 || r.cgst !== 0 || r.sgst !== 0).map((r) => ({
    sply_ty: posCode(r.pos) === supplier ? "INTRA" : "INTER", rt: r.rate, typ: r.type,
    ...(r.ecommerceGstin ? { etin: r.ecommerceGstin } : {}), pos: posCode(r.pos),
    txval: n2(r.taxable), iamt: n2(r.igst), camt: n2(r.cgst), samt: n2(r.sgst), csamt: n2(r.cess),
  }));

  // cdnr / cdnur ----------------------------------------------------------------------------------------------------
  const cdnr = [...group(rep.cdnr, (r) => r.gstin)].map(([ctin, rows]) => ({
    ctin,
    nt: [...invoicesOf<CdnrRow>(rows)].map(([, lines]) => {
      const f = lines[0];
      return {
        ntty: f.noteType, nt_num: f.number, nt_dt: fmtDateJson(f.date), val: n2(f.value), pos: posCode(f.pos), rchrg: f.reverseCharge,
        inv_typ: JSON_INVOICE_TYPE[f.invoiceType as keyof typeof JSON_INVOICE_TYPE] ?? "R", itms: itms(lines, true),
      };
    }),
  }));
  const cdnur = [...group(rep.cdnur, (r) => r.docId)].map(([, lines]) => ({
    typ: lines[0].urType, ntty: lines[0].noteType, nt_num: lines[0].number, nt_dt: fmtDateJson(lines[0].date), val: n2(lines[0].value), pos: posCode(lines[0].pos),
    itms: itms(lines, false).map((x) => ({ num: x.num, itm_det: { rt: x.itm_det.rt, txval: x.itm_det.txval, iamt: x.itm_det.iamt, csamt: x.itm_det.csamt } })),
  }));

  // exp ------------------------------------------------------------------------------------------------------------------
  const exp = [...group(rep.exp, (r) => r.exportType)].map(([exp_typ, rows]) => ({
    exp_typ,
    inv: [...invoicesOf<ExpRow>(rows)].map(([, lines]) => ({
      inum: lines[0].number, idt: fmtDateJson(lines[0].date), val: n2(lines[0].value),
      ...(lines[0].portCode ? { sbpcode: lines[0].portCode } : {}), ...(lines[0].shippingBillNumber ? { sbnum: lines[0].shippingBillNumber } : {}),
      ...(lines[0].shippingBillDate ? { sbdt: fmtDateJson(lines[0].shippingBillDate) } : {}),
      itms: lines.map((l) => ({ txval: n2(l.taxable), rt: l.rate, iamt: n2(l.igst), csamt: n2(l.cess) })),
    })),
  }));

  // at / txpd -------------------------------------------------------------------------------------------------------------
  const advance = (rows: Gstr1Report["at"]) => [...group(rows, (r) => r.pos)].map(([pos, list]) => ({
    pos: posCode(pos), sply_ty: posCode(pos) === supplier ? "INTRA" : "INTER",
    itms: list.map((r) => ({ rt: r.rate, ad_amt: n2(r.amount), iamt: n2(r.igst), camt: n2(r.cgst), samt: n2(r.sgst), csamt: n2(r.cess) })),
  }));

  // nil ------------------------------------------------------------------------------------------------------------------------
  const nil = { inv: EXEMP_CATEGORIES.map((e) => { const b = rep.exemp.find((x) => x.key === e.key)!; return { sply_ty: e.json, expt_amt: n2(b.exempted), nil_amt: n2(b.nil), ngsup_amt: n2(b.nonGst) }; }) };

  // hsn -------------------------------------------------------------------------------------------------------------------------
  const hsnRows = (rows: HsnRow[]) => rows.map((r, i) => ({
    num: i + 1, hsn_sc: r.hsn, desc: r.description.slice(0, 30), uqc: uqcCode(r.uqc), qty: r.quantity, rt: r.rate, val: n2(r.value), txval: n2(r.taxable),
    iamt: n2(r.igst), camt: n2(r.cgst), samt: n2(r.sgst), csamt: n2(r.cess),
  }));
  const hsn = rep.rulesApplied.hsnSplit
    ? { hsn_b2b: hsnRows(rep.hsnB2b), hsn_b2c: hsnRows(rep.hsnB2c) }
    : { data: hsnRows([...rep.hsnB2b, ...rep.hsnB2c]) };

  // doc_issue ----------------------------------------------------------------------------------------------------------------------
  const doc_issue = {
    doc_det: DOC_NATURES.filter((d) => rep.docs.some((r) => r.nature === d.name)).map((d) => ({
      doc_num: d.code, doc_typ: d.name,
      docs: rep.docs.filter((r) => r.nature === d.name).map((r, i) => ({ num: i + 1, from: r.from, to: r.to, totnum: r.total, cancel: r.cancelled, net_issue: r.total - r.cancelled })),
    })),
  };

  const json: Record<string, unknown> = {
    gstin: rep.firm.gstin, fp: rep.period.fp, gt: n2(rep.firm.previousFyTurnover!), cur_gt: n2(rep.firm.currentFyTurnover!),
    version: OFFLINE_TOOL_VERSION, hash: "hash",
  };
  // Empty sections are omitted, as the portal expects.
  const sections: Record<string, unknown[]> = { b2b, b2cl, b2cs, cdnr, cdnur, exp, at: advance(rep.at), txpd: advance(rep.atadj) };
  for (const [k, v] of Object.entries(sections)) if (v.length) json[k] = v;
  if (rep.exemp.some((e) => e.nil || e.exempted || e.nonGst)) json.nil = nil;
  if (rep.hsnB2b.length || rep.hsnB2c.length) json.hsn = hsn;
  if (doc_issue.doc_det.length) json.doc_issue = doc_issue;
  return { json, blockers: [] };
}
