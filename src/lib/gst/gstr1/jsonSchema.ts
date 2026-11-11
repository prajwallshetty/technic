import Ajv, { type ErrorObject } from "ajv";

import { TAX_RATES, UQC_LIST } from "./masters";

/**
 * Structural validation of the GSTR-1 JSON.
 *
 * IMPORTANT — what this is and is not:
 *   The official GSTR-1 request schema is only published through the GST
 *   developer portal ("GSTR1 - Save GSTR1 data" → Request Payload → Download
 *   Schema), behind an interactive download; the offline tool embeds it inside
 *   its executable. It could not be fetched here. The built-in schema below is
 *   therefore reconstructed from the GSTN API documentation and the official
 *   offline-tool conventions (masters, date formats, invoice-number rules). It
 *   catches structural mistakes, but passing it does NOT prove the portal will
 *   accept the file.
 *
 *   When the official schema is supplied (data/gstr1-reference/gstr1-schema.json),
 *   the JSON is validated against it as well and the result says so.
 */
const gstinRe = "^\\d{2}[A-Z]{5}\\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$";
const dateRe = "^\\d{2}-\\d{2}-\\d{4}$";
const docNoRe = "^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$";
const rate = { type: "number", enum: [...TAX_RATES] } as const;
const amt = { type: "number" } as const;
const pos = { type: "string", pattern: "^\\d{2}$" } as const;
const uqc = { type: "string", enum: UQC_LIST.map((u) => u.split("-")[0]) } as const;

const itemDet = (cs: boolean) => ({
  type: "object", required: ["rt", "txval"], additionalProperties: false,
  properties: { rt: rate, txval: amt, iamt: amt, ...(cs ? { camt: amt, samt: amt } : {}), csamt: amt },
});
const items = (cs: boolean) => ({
  type: "array", minItems: 1,
  items: { type: "object", required: ["num", "itm_det"], additionalProperties: false, properties: { num: { type: "integer", minimum: 1 }, itm_det: itemDet(cs) } },
});
const advItems = { type: "array", minItems: 1, items: { type: "object", required: ["rt", "ad_amt"], additionalProperties: false, properties: { rt: rate, ad_amt: amt, iamt: amt, camt: amt, samt: amt, csamt: amt } } };
const hsnItem = {
  type: "object", required: ["num", "hsn_sc", "uqc", "qty", "txval"], additionalProperties: false,
  properties: { num: { type: "integer", minimum: 1 }, hsn_sc: { type: "string", pattern: "^\\d{2,8}$" }, desc: { type: "string", maxLength: 30 }, uqc, qty: { type: "number" }, rt: rate, val: amt, txval: amt, iamt: amt, camt: amt, samt: amt, csamt: amt },
};

export const GSTR1_SCHEMA = {
  type: "object",
  required: ["gstin", "fp", "gt", "cur_gt"],
  additionalProperties: false,
  properties: {
    gstin: { type: "string", pattern: gstinRe },
    fp: { type: "string", pattern: "^(0[1-9]|1[0-2])\\d{4}$" },
    gt: amt, cur_gt: amt, version: { type: "string" }, hash: { type: "string" },
    b2b: { type: "array", items: { type: "object", required: ["ctin", "inv"], additionalProperties: false, properties: {
      ctin: { type: "string", pattern: gstinRe },
      inv: { type: "array", minItems: 1, items: { type: "object", required: ["inum", "idt", "val", "pos", "rchrg", "inv_typ", "itms"], additionalProperties: false, properties: {
        inum: { type: "string", pattern: docNoRe }, idt: { type: "string", pattern: dateRe }, val: amt, pos, rchrg: { enum: ["Y", "N"] }, etin: { type: "string", pattern: gstinRe },
        inv_typ: { enum: ["R", "SEWP", "SEWOP", "DE", "CBW"] }, itms: items(true) } } } } } },
    b2cl: { type: "array", items: { type: "object", required: ["pos", "inv"], additionalProperties: false, properties: {
      pos, inv: { type: "array", minItems: 1, items: { type: "object", required: ["inum", "idt", "val", "itms"], additionalProperties: false, properties: {
        inum: { type: "string", pattern: docNoRe }, idt: { type: "string", pattern: dateRe }, val: amt, etin: { type: "string", pattern: gstinRe }, itms: items(false) } } } } } },
    b2cs: { type: "array", items: { type: "object", required: ["sply_ty", "rt", "typ", "pos", "txval"], additionalProperties: false, properties: {
      sply_ty: { enum: ["INTRA", "INTER"] }, rt: rate, typ: { enum: ["OE", "E"] }, etin: { type: "string", pattern: gstinRe }, pos, txval: amt, iamt: amt, camt: amt, samt: amt, csamt: amt } } },
    cdnr: { type: "array", items: { type: "object", required: ["ctin", "nt"], additionalProperties: false, properties: {
      ctin: { type: "string", pattern: gstinRe },
      nt: { type: "array", minItems: 1, items: { type: "object", required: ["ntty", "nt_num", "nt_dt", "val", "pos", "rchrg", "inv_typ", "itms"], additionalProperties: false, properties: {
        ntty: { enum: ["C", "D"] }, nt_num: { type: "string", pattern: docNoRe }, nt_dt: { type: "string", pattern: dateRe }, val: amt, pos, rchrg: { enum: ["Y", "N"] }, inv_typ: { enum: ["R", "SEWP", "SEWOP", "DE", "CBW"] }, itms: items(true) } } } } } },
    cdnur: { type: "array", items: { type: "object", required: ["typ", "ntty", "nt_num", "nt_dt", "val", "pos", "itms"], additionalProperties: false, properties: {
      typ: { enum: ["B2CL", "EXPWP", "EXPWOP"] }, ntty: { enum: ["C", "D"] }, nt_num: { type: "string", pattern: docNoRe }, nt_dt: { type: "string", pattern: dateRe }, val: amt, pos, itms: items(false) } } },
    exp: { type: "array", items: { type: "object", required: ["exp_typ", "inv"], additionalProperties: false, properties: {
      exp_typ: { enum: ["WPAY", "WOPAY"] },
      inv: { type: "array", minItems: 1, items: { type: "object", required: ["inum", "idt", "val", "itms"], additionalProperties: false, properties: {
        inum: { type: "string", pattern: docNoRe }, idt: { type: "string", pattern: dateRe }, val: amt, sbpcode: { type: "string" }, sbnum: { type: "string" }, sbdt: { type: "string", pattern: dateRe },
        itms: { type: "array", minItems: 1, items: { type: "object", required: ["txval", "rt"], additionalProperties: false, properties: { txval: amt, rt: rate, iamt: amt, csamt: amt } } } } } } } } },
    at: { type: "array", items: { type: "object", required: ["pos", "sply_ty", "itms"], additionalProperties: false, properties: { pos, sply_ty: { enum: ["INTRA", "INTER"] }, itms: advItems } } },
    txpd: { type: "array", items: { type: "object", required: ["pos", "sply_ty", "itms"], additionalProperties: false, properties: { pos, sply_ty: { enum: ["INTRA", "INTER"] }, itms: advItems } } },
    nil: { type: "object", required: ["inv"], additionalProperties: false, properties: { inv: { type: "array", items: { type: "object", required: ["sply_ty"], additionalProperties: false, properties: {
      sply_ty: { enum: ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"] }, expt_amt: amt, nil_amt: amt, ngsup_amt: amt } } } } },
    hsn: { type: "object", additionalProperties: false, properties: {
      data: { type: "array", items: hsnItem }, hsn_b2b: { type: "array", items: hsnItem }, hsn_b2c: { type: "array", items: hsnItem } } },
    doc_issue: { type: "object", required: ["doc_det"], additionalProperties: false, properties: { doc_det: { type: "array", items: { type: "object", required: ["doc_num", "doc_typ", "docs"], additionalProperties: false, properties: {
      doc_num: { type: "integer", minimum: 1, maximum: 12 }, doc_typ: { type: "string" },
      docs: { type: "array", minItems: 1, items: { type: "object", required: ["num", "from", "to", "totnum", "cancel", "net_issue"], additionalProperties: false, properties: {
        num: { type: "integer", minimum: 1 }, from: { type: "string", pattern: docNoRe }, to: { type: "string", pattern: docNoRe }, totnum: { type: "integer", minimum: 0 }, cancel: { type: "integer", minimum: 0 }, net_issue: { type: "integer", minimum: 0 } } } } } } } } },
  },
} as const;

export interface JsonValidation {
  ok: boolean;
  errors: string[];
  /** What was checked, so the UI never overstates it. */
  checkedAgainst: { builtIn: true; official: boolean };
  /** Always present: reminds the reader what a pass means. */
  caveat: string;
}

const fmt = (e: ErrorObject) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}${e.params && "allowedValues" in e.params ? ` (${(e.params.allowedValues as unknown[]).join(", ")})` : ""}`;

/** Extra rules a plain JSON schema cannot express. */
function semanticErrors(json: Record<string, any>): string[] {
  const errs: string[] = [];
  for (const d of json.doc_issue?.doc_det ?? []) for (const x of d.docs ?? []) if (x.net_issue !== x.totnum - x.cancel) errs.push(`doc_issue ${d.doc_typ} ${x.from}-${x.to}: net_issue must equal totnum − cancel`);
  const money = (section: string, list: any[], pick: (x: any) => any[]) => {
    for (const x of list ?? []) for (const it of pick(x)) {
      const d = it.itm_det; if (!d) continue;
      for (const k of ["txval", "iamt", "camt", "samt", "csamt"]) if (d[k] !== undefined && Math.abs(d[k] * 100 - Math.round(d[k] * 100)) > 1e-6) errs.push(`${section}: ${k} ${d[k]} has more than 2 decimals`);
    }
  };
  for (const g of json.b2b ?? []) money("b2b", g.inv, (i) => i.itms);
  return errs;
}

export function validateGstr1Json(json: unknown, officialSchema?: object | null): JsonValidation {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const errors: string[] = [];
  const builtIn = ajv.compile(GSTR1_SCHEMA as object);
  if (!builtIn(json)) errors.push(...(builtIn.errors ?? []).map(fmt));
  errors.push(...semanticErrors(json as Record<string, any>));
  let official = false;
  if (officialSchema) {
    official = true;
    const strict = new Ajv({ allErrors: true, strict: false });
    const v = strict.compile(officialSchema);
    if (!v(json)) errors.push(...(v.errors ?? []).map((e) => `official schema: ${fmt(e)}`));
  }
  return {
    ok: errors.length === 0, errors, checkedAgainst: { builtIn: true, official },
    caveat: official
      ? "Validated against the supplied official schema and the built-in structural checks."
      : "Validated against a built-in structural schema reconstructed from the GSTN documentation — NOT the official portal schema. Download the official schema from the GST developer portal and place it at data/gstr1-reference/gstr1-schema.json to validate against it.",
  };
}
