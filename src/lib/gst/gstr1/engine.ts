import { B2B_INVOICE_TYPE, EXEMP_CATEGORIES, normaliseUqc, posLabel, stateCodeFromGstin, stateCodeFromName } from "./masters";
import { rulesFor, type PeriodRules } from "./rules";
import type {
  AdvanceRow, B2bRow, B2clRow, B2csRow, CdnrRow, CdnurRow, DocSeriesRow, ExempBucket, ExpRow, GstDoc, GstLine,
  GstrInput, HsnRow, HsnTotals, RateRow, ReportRow, SectionTotals,
} from "./types";
import { naturalCompare, r2, splitSeries, sum } from "./util";

/**
 * Section classification and aggregation. Pure functions over normalised
 * documents: nothing here reads a database or fills in a missing value — a
 * missing place of supply stays blank (and is reported by validate.ts).
 */

export type SectionKey = "B2B" | "B2CL" | "B2CS" | "EXP" | "CDNR" | "CDNUR" | "NIL_ONLY" | "CANCELLED";

export interface DocContext {
  doc: GstDoc;
  sign: 1 | -1;
  posCode: string | null;
  interState: boolean;
  registered: boolean;
  isExport: boolean;
  isSezOrDeemed: boolean;
  section: SectionKey;
  /** Taxable lines grouped by (rate, cess rate). */
  rateRows: RateRow[];
}

const isNote = (d: GstDoc) => d.kind !== "INVOICE";

export function supplierStateCode(input: GstrInput): string | null {
  return input.firm.stateCode ?? stateCodeFromGstin(input.firm.gstin);
}

export function posCodeOf(doc: GstDoc): string | null {
  return doc.placeOfSupplyCode ?? stateCodeFromName(doc.placeOfSupplyName);
}

export function groupRates(lines: GstLine[]): RateRow[] {
  const map = new Map<string, RateRow>();
  for (const l of lines) {
    if (l.taxability !== "TAXABLE" || l.rate === null) continue;
    const key = `${l.rate}|${l.cessRate}`;
    const row = map.get(key) ?? { rate: l.rate, cessRate: l.cessRate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    row.taxable += l.taxable; row.igst += l.igst; row.cgst += l.cgst; row.sgst += l.sgst; row.cess += l.cess;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, taxable: r2(r.taxable), igst: r2(r.igst), cgst: r2(r.cgst), sgst: r2(r.sgst), cess: r2(r.cess) }))
    .sort((a, b) => a.rate - b.rate || a.cessRate - b.cessRate);
}

export function contextFor(doc: GstDoc, supplierState: string | null, rules: PeriodRules): DocContext {
  const posCode = posCodeOf(doc);
  const igst = doc.lines.reduce((n, l) => n + l.igst, 0) + (doc.lines.length ? 0 : doc.totals.igst);
  const interState = posCode && supplierState ? posCode !== supplierState : igst > 0;
  const registered = !!doc.party.gstin?.trim();
  const isExport = doc.supplyType === "EXPORT_WITH_PAYMENT" || doc.supplyType === "EXPORT_WITHOUT_PAYMENT";
  const isSezOrDeemed = doc.supplyType === "SEZ_WITH_PAYMENT" || doc.supplyType === "SEZ_WITHOUT_PAYMENT" || doc.supplyType === "DEEMED_EXPORT";
  const sign: 1 | -1 = doc.kind === "CREDIT_NOTE" ? -1 : 1;
  const rateRows = groupRates(doc.lines);

  let section: SectionKey;
  if (doc.status === "CANCELLED") section = "CANCELLED";
  else if (!isNote(doc)) {
    if (isExport) section = "EXP";
    else if (isSezOrDeemed || registered) section = "B2B";
    else section = interState && doc.totals.total > rules.b2clThreshold ? "B2CL" : "B2CS";
  } else if (isExport) section = "CDNUR";
  else if (isSezOrDeemed || registered) section = "CDNR";
  else section = interState && doc.totals.total > rules.b2clThreshold ? "CDNUR" : "B2CS";

  // An invoice whose every line is nil-rated/exempt/non-GST appears only in Table 8.
  if (section !== "CANCELLED" && rateRows.length === 0 && doc.lines.length > 0) section = "NIL_ONLY";
  return { doc, sign, posCode, interState, registered, isExport, isSezOrDeemed, section, rateRows };
}

export function sortDocs(docs: GstDoc[]): GstDoc[] {
  return [...docs].sort((a, b) => a.date.localeCompare(b.date) || naturalCompare(a.number, b.number));
}

const pos = (c: DocContext) => posLabel(c.posCode) ?? "";

export interface Sections {
  contexts: DocContext[];
  rows: ReportRow[];
  b2b: B2bRow[];
  b2cl: B2clRow[];
  b2cs: B2csRow[];
  cdnr: CdnrRow[];
  cdnur: CdnurRow[];
  exp: ExpRow[];
  at: AdvanceRow[];
  atadj: AdvanceRow[];
  exemp: ExempBucket[];
  hsnB2b: HsnRow[];
  hsnB2c: HsnRow[];
  items: HsnRow[];
  hsnTotals: { b2b: HsnTotals; b2c: HsnTotals; items: HsnTotals };
  docs: DocSeriesRow[];
  rules: PeriodRules;
  supplierState: string | null;
}

export function buildSections(input: GstrInput): Sections {
  const rules = rulesFor(input.period.from, input.firm);
  const supplierState = supplierStateCode(input);
  const ordered = sortDocs(input.docs);
  const contexts = ordered.map((d) => contextFor(d, supplierState, rules));
  const live = contexts.filter((c) => c.section !== "CANCELLED");

  // ---- GSTR1 Report (register view) -----------------------------------------------
  const rows: ReportRow[] = [];
  for (const c of live) {
    const { doc } = c;
    const groups = new Map<string, { rate: number; cessRate: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number }>();
    for (const l of doc.lines) {
      const rate = l.rate ?? 0;
      const key = `${rate}|${l.cessRate}|${l.taxability}`;
      const g = groups.get(key) ?? { rate, cessRate: l.cessRate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      g.taxable += l.taxable; g.igst += l.igst; g.cgst += l.cgst; g.sgst += l.sgst; g.cess += l.cess;
      groups.set(key, g);
    }
    let first = true;
    for (const g of [...groups.values()].sort((a, b) => a.rate - b.rate)) {
      rows.push({
        gstin: doc.party.gstin?.trim() ?? "", partyName: doc.party.name,
        txnType: doc.kind === "INVOICE" ? "Sale" : doc.kind === "CREDIT_NOTE" ? "Credit Note" : "Debit Note",
        number: doc.number, date: doc.date, value: first ? doc.totals.total : 0, rate: g.rate, cessRate: g.cessRate,
        taxable: r2(g.taxable), reverseCharge: doc.reverseCharge ? "Y" : "N",
        igst: r2(g.igst), cgst: r2(g.cgst), sgst: r2(g.sgst), cess: r2(g.cess), posName: c.posCode ? (posLabel(c.posCode) ?? "").replace(/^\d+-/, "") : "", docId: doc.id,
      });
      first = false;
    }
  }

  // ---- B2B / SEZ / DE, B2CL, EXP, CDNR, CDNUR -----------------------------------------
  const b2b: B2bRow[] = [], b2cl: B2clRow[] = [], exp: ExpRow[] = [], cdnr: CdnrRow[] = [], cdnur: CdnurRow[] = [];
  for (const c of live) {
    const { doc } = c;
    for (const r of c.rateRows) {
      const common = { rate: r.rate, taxable: r.taxable, cess: r.cess, igst: r.igst, docId: doc.id };
      if (c.section === "B2B") {
        b2b.push({
          gstin: doc.party.gstin!.trim(), name: doc.party.name, number: doc.number, date: doc.date, value: doc.totals.total, pos: pos(c),
          reverseCharge: doc.reverseCharge ? "Y" : "N", applicablePct: null,
          invoiceType: B2B_INVOICE_TYPE[doc.supplyType as keyof typeof B2B_INVOICE_TYPE] ?? B2B_INVOICE_TYPE.REGULAR,
          ecommerceGstin: doc.ecommerceGstin ?? "", cgst: r.cgst, sgst: r.sgst, supplyType: doc.supplyType, ...common,
        });
      } else if (c.section === "B2CL") {
        b2cl.push({ number: doc.number, date: doc.date, value: doc.totals.total, pos: pos(c), ecommerceGstin: doc.ecommerceGstin ?? "", ...common });
      } else if (c.section === "EXP") {
        exp.push({
          exportType: doc.supplyType === "EXPORT_WITH_PAYMENT" ? "WPAY" : "WOPAY", number: doc.number, date: doc.date, value: doc.totals.total,
          portCode: doc.exportDetails?.portCode ?? "", shippingBillNumber: doc.exportDetails?.shippingBillNumber ?? "",
          shippingBillDate: doc.exportDetails?.shippingBillDate ?? "", rate: r.rate, taxable: r.taxable, igst: r.igst, cess: r.cess, docId: doc.id,
        });
      } else if (c.section === "CDNR") {
        cdnr.push({
          gstin: doc.party.gstin!.trim(), name: doc.party.name, number: doc.number, date: doc.date, noteType: doc.kind === "CREDIT_NOTE" ? "C" : "D",
          pos: pos(c), reverseCharge: doc.reverseCharge ? "Y" : "N",
          supplyType: B2B_INVOICE_TYPE[doc.supplyType as keyof typeof B2B_INVOICE_TYPE] ?? B2B_INVOICE_TYPE.REGULAR,
          value: doc.totals.total, cgst: r.cgst, sgst: r.sgst, invoiceType: doc.supplyType,
          originalNumber: doc.original?.number ?? null, originalDate: doc.original?.date ?? null, ...common,
        });
      } else if (c.section === "CDNUR") {
        cdnur.push({
          urType: c.isExport ? (doc.supplyType === "EXPORT_WITH_PAYMENT" ? "EXPWP" : "EXPWOP") : "B2CL",
          number: doc.number, date: doc.date, noteType: doc.kind === "CREDIT_NOTE" ? "C" : "D", pos: pos(c), value: doc.totals.total, ...common,
        });
      }
    }
  }

  // ---- B2CS (summary, net of notes to small unregistered buyers) ------------------------
  const b2csMap = new Map<string, B2csRow>();
  for (const c of live) {
    if (c.section !== "B2CS") continue;
    for (const r of c.rateRows) {
      const type = c.doc.ecommerceGstin ? "E" : "OE";
      const key = `${type}|${pos(c)}|${r.rate}|${c.doc.ecommerceGstin ?? ""}`;
      const row = b2csMap.get(key) ?? { type, pos: pos(c), rate: r.rate, taxable: 0, cess: 0, igst: 0, cgst: 0, sgst: 0, ecommerceGstin: c.doc.ecommerceGstin ?? "" } as B2csRow;
      row.taxable += c.sign * r.taxable; row.cess += c.sign * r.cess; row.igst += c.sign * r.igst; row.cgst += c.sign * r.cgst; row.sgst += c.sign * r.sgst;
      b2csMap.set(key, row);
    }
  }
  const b2cs = [...b2csMap.values()]
    .map((r) => ({ ...r, taxable: r2(r.taxable), cess: r2(r.cess), igst: r2(r.igst), cgst: r2(r.cgst), sgst: r2(r.sgst) }))
    .sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);

  // ---- Table 8: nil-rated / exempted / non-GST ---------------------------------------------
  const exempMap = new Map<string, ExempBucket>(EXEMP_CATEGORIES.map((e) => [e.key, { key: e.key, nil: 0, exempted: 0, nonGst: 0 }]));
  for (const c of live) {
    const key = `${c.interState ? "INTER" : "INTRA"}_${c.registered ? "REG" : "UNREG"}` as ExempBucket["key"];
    const bucket = exempMap.get(key)!;
    for (const l of c.doc.lines) {
      if (l.taxability === "TAXABLE") continue;
      const v = c.sign * l.taxable;
      if (l.taxability === "NIL_RATED") bucket.nil += v;
      else if (l.taxability === "EXEMPTED") bucket.exempted += v;
      else bucket.nonGst += v;
    }
  }
  const exemp = EXEMP_CATEGORIES.map((e) => {
    const b = exempMap.get(e.key)!;
    return { key: e.key, nil: r2(b.nil), exempted: r2(b.exempted), nonGst: r2(b.nonGst) };
  });

  // ---- Table 12 (HSN) and the item summary -----------------------------------------------------
  const hsnB2b = new Map<string, HsnRow>(), hsnB2c = new Map<string, HsnRow>(), itemMap = new Map<string, HsnRow>();
  const addLine = (map: Map<string, HsnRow>, keyParts: string[], base: Omit<HsnRow, "quantity" | "value" | "taxable" | "igst" | "cgst" | "sgst" | "cess">, c: DocContext, l: GstLine) => {
    const key = keyParts.join("\u0001");
    const row = map.get(key) ?? { ...base, quantity: 0, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    row.quantity += c.sign * l.quantity;
    row.value += c.sign * (l.taxable + l.igst + l.cgst + l.sgst + l.cess);
    row.taxable += c.sign * l.taxable; row.igst += c.sign * l.igst; row.cgst += c.sign * l.cgst; row.sgst += c.sign * l.sgst; row.cess += c.sign * l.cess;
    map.set(key, row);
  };
  for (const c of live) {
    for (const l of c.doc.lines) {
      const hsn = (l.hsn ?? "").trim();
      const uqc = normaliseUqc(l.uqc) ?? "";
      const rate = l.rate ?? 0;
      const target = c.registered || c.isSezOrDeemed ? hsnB2b : hsnB2c;
      addLine(target, [hsn, uqc, String(rate)], { hsn, description: "", uqc, rate }, c, l);
      addLine(itemMap, [l.description.trim(), hsn, uqc, String(rate)], { hsn, description: l.description.trim(), uqc, rate }, c, l);
    }
  }
  const totalsOf = (m: Map<string, HsnRow>): HsnTotals => {
    const t = { value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    for (const r of m.values()) { t.value += r.value; t.taxable += r.taxable; t.igst += r.igst; t.cgst += r.cgst; t.sgst += r.sgst; t.cess += r.cess; }
    return { value: r2(t.value), taxable: r2(t.taxable), igst: r2(t.igst), cgst: r2(t.cgst), sgst: r2(t.sgst), cess: r2(t.cess) };
  };
  const hsnTotals = { b2b: totalsOf(hsnB2b), b2c: totalsOf(hsnB2c), items: totalsOf(itemMap) };
  const finish = (m: Map<string, HsnRow>): HsnRow[] =>
    [...m.values()].map((r) => ({ ...r, quantity: Math.round(r.quantity * 1000) / 1000, value: r2(r.value), taxable: r2(r.taxable), igst: r2(r.igst), cgst: r2(r.cgst), sgst: r2(r.sgst), cess: r2(r.cess) }));

  // ---- Advances (Table 11) ---------------------------------------------------------------------------
  const advanceRows = (entries: { posCode: string | null; rate: number; cessRate: number; gross: number }[]): AdvanceRow[] => {
    const map = new Map<string, AdvanceRow>();
    for (const e of entries) {
      const denominator = 100 + e.rate + e.cessRate;
      const tax = (e.gross * e.rate) / denominator;
      const cess = (e.gross * e.cessRate) / denominator;
      const inter = e.posCode && supplierState ? e.posCode !== supplierState : false;
      const key = `${e.posCode ?? ""}|${e.rate}`;
      const row = map.get(key) ?? { pos: posLabel(e.posCode) ?? "", rate: e.rate, amount: 0, cess: 0, igst: 0, cgst: 0, sgst: 0 };
      row.amount += e.gross; row.cess += cess;
      if (inter) row.igst += tax; else { row.cgst += tax / 2; row.sgst += tax / 2; }
      map.set(key, row);
    }
    return [...map.values()].map((r) => ({ ...r, amount: r2(r.amount), cess: r2(r.cess), igst: r2(r.igst), cgst: r2(r.cgst), sgst: r2(r.sgst) })).sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  };
  const live_adv = input.advances.filter((a) => a.status === "RECEIVED");
  const at = advanceRows(live_adv.filter((a) => a.date >= input.period.from && a.date <= input.period.to).map((a) => ({
    posCode: a.placeOfSupplyCode ?? stateCodeFromName(a.placeOfSupplyName), rate: a.rate, cessRate: a.cessRate, gross: a.grossAmount,
  })));
  const advById = new Map(live_adv.map((a) => [a.id, a]));
  const atadj = advanceRows(input.adjustments.filter((x) => x.date >= input.period.from && x.date <= input.period.to && advById.has(x.advanceId)).map((x) => {
    const a = advById.get(x.advanceId)!;
    return { posCode: a.placeOfSupplyCode ?? stateCodeFromName(a.placeOfSupplyName), rate: a.rate, cessRate: a.cessRate, gross: x.amount };
  }));

  return {
    contexts, rows, b2b, b2cl, b2cs, cdnr, cdnur, exp, at, atadj, exemp,
    hsnB2b: finish(hsnB2b), hsnB2c: finish(hsnB2c), items: finish(itemMap), hsnTotals,
    docs: documentSeries(input.docs), rules, supplierState,
  };
}

/** Table 13: ranges of documents issued in the period, per nature and per numbering series. */
export function documentSeries(docs: GstDoc[]): DocSeriesRow[] {
  const natures = [
    { kind: "INVOICE", nature: "Invoices for outward supply" },
    { kind: "CREDIT_NOTE", nature: "Credit Note" },
    { kind: "DEBIT_NOTE", nature: "Debit Note" },
  ] as const;
  const out: DocSeriesRow[] = [];
  for (const { kind, nature } of natures) {
    const mine = docs.filter((d) => d.kind === kind);
    const series = new Map<string, GstDoc[]>();
    for (const d of mine) {
      const key = splitSeries(d.number).prefix;
      series.set(key, [...(series.get(key) ?? []), d]);
    }
    for (const list of series.values()) {
      const sorted = [...list].sort((a, b) => naturalCompare(a.number, b.number));
      const nums = sorted.map((d) => splitSeries(d.number));
      const seqs = nums.map((n) => n.seq).filter((n): n is number => n !== null);
      const missing: string[] = [];
      if (seqs.length === sorted.length && seqs.length > 1) {
        const have = new Set(seqs);
        const width = nums[0].width;
        for (let n = Math.min(...seqs); n <= Math.max(...seqs); n++) if (!have.has(n)) missing.push(`${nums[0].prefix}${String(n).padStart(width, "0")}`);
      }
      out.push({ nature, from: sorted[0].number, to: sorted[sorted.length - 1].number, total: sorted.length, cancelled: sorted.filter((d) => d.status === "CANCELLED").length, missing });
    }
  }
  return out;
}

export function sectionTotals(sec: Sections): SectionTotals {
  const uniq = <T,>(a: T[]) => new Set(a).size;
  const invValue = (rows: { docId: string; value: number }[]) => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.docId, r.value);
    return sum([...seen.values()]);
  };
  const live = sec.contexts.filter((c) => c.section !== "CANCELLED");
  const net = { value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  for (const c of live) {
    net.value += c.sign * c.doc.totals.total;
    for (const l of c.doc.lines) { net.taxable += c.sign * l.taxable; net.igst += c.sign * l.igst; net.cgst += c.sign * l.cgst; net.sgst += c.sign * l.sgst; net.cess += c.sign * l.cess; }
  }
  return {
    invoiceCount: live.filter((c) => c.doc.kind === "INVOICE").length,
    noteCount: live.filter((c) => c.doc.kind !== "INVOICE").length,
    cancelledCount: sec.contexts.length - live.length,
    b2b: { invoices: uniq(sec.b2b.map((r) => r.docId)), recipients: uniq(sec.b2b.map((r) => r.gstin)), value: invValue(sec.b2b), taxable: sum(sec.b2b.map((r) => r.taxable)), cess: sum(sec.b2b.map((r) => r.cess)) },
    b2cl: { invoices: uniq(sec.b2cl.map((r) => r.docId)), value: invValue(sec.b2cl), taxable: sum(sec.b2cl.map((r) => r.taxable)), cess: sum(sec.b2cl.map((r) => r.cess)) },
    b2cs: { taxable: sum(sec.b2cs.map((r) => r.taxable)), cess: sum(sec.b2cs.map((r) => r.cess)) },
    cdnr: { notes: uniq(sec.cdnr.map((r) => r.docId)), recipients: uniq(sec.cdnr.map((r) => r.gstin)), value: invValue(sec.cdnr), taxable: sum(sec.cdnr.map((r) => r.taxable)), cess: sum(sec.cdnr.map((r) => r.cess)) },
    cdnur: { notes: uniq(sec.cdnur.map((r) => r.docId)), value: invValue(sec.cdnur), taxable: sum(sec.cdnur.map((r) => r.taxable)), cess: sum(sec.cdnur.map((r) => r.cess)) },
    exp: { invoices: uniq(sec.exp.map((r) => r.docId)), value: invValue(sec.exp), taxable: sum(sec.exp.map((r) => r.taxable)), shippingBills: uniq(sec.exp.map((r) => r.shippingBillNumber).filter(Boolean)) },
    at: { amount: sum(sec.at.map((r) => r.amount)), cess: sum(sec.at.map((r) => r.cess)) },
    atadj: { amount: sum(sec.atadj.map((r) => r.amount)), cess: sum(sec.atadj.map((r) => r.cess)) },
    exemp: { nil: sum(sec.exemp.map((r) => r.nil)), exempted: sum(sec.exemp.map((r) => r.exempted)), nonGst: sum(sec.exemp.map((r) => r.nonGst)) },
    net: { value: r2(net.value), taxable: r2(net.taxable), igst: r2(net.igst), cgst: r2(net.cgst), sgst: r2(net.sgst), cess: r2(net.cess) },
  };
}
