import { isValidRate, normaliseUqc, posLabel, stateCodeFromGstin } from "./masters";
import type { DocContext, Sections } from "./engine";
import type { GstDoc, GstrInput, Issue } from "./types";
import { checkGstin, naturalCompare, r2 } from "./util";

/**
 * Pre-export validation. Every finding names the document and what to change;
 * `blocking` means the Excel or JSON would be wrong, or rejected by the portal,
 * until it is corrected. Nothing here edits or fills in data.
 */
const INVOICE_NO = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;
const TOL_LINE = 0.02; // paise-level rounding inside one line
const HSN_LENGTHS = new Set([2, 4, 6, 8]);

export function validate(input: GstrInput, sec: Sections): Issue[] {
  const issues: Issue[] = [];
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const add = (i: Omit<Issue, "blocking"> & { blocking?: boolean }) => issues.push({ blocking: i.severity === "ERROR", ...i });
  const where = (c: DocContext | GstDoc) => {
    const d = "doc" in c ? c.doc : c;
    return { docId: d.id, docNumber: d.number, docKind: d.kind, link: d.link };
  };
  const label = (d: GstDoc) => `${d.kind === "INVOICE" ? "Invoice" : d.kind === "CREDIT_NOTE" ? "Credit note" : "Debit note"} ${d.number}`;

  // ---- the registered person ----------------------------------------------------------
  const own = checkGstin(input.firm.gstin);
  if (own !== "OK") {
    add({ code: "FIRM_GSTIN_INVALID", severity: "ERROR", message: `Your own GSTIN "${input.firm.gstin}" is not valid (${own.replace(/_/g, " ").toLowerCase()}).`, fix: "Correct the GSTIN under Firms / Settings." });
  }
  if (!input.firm.legalName) add({ code: "FIRM_LEGAL_NAME_MISSING", severity: "WARNING", message: "Legal name of the registered person is not set; it is printed on the GSTR1 Report sheet.", fix: "Set the firm legal name (as on the GST certificate)." });
  if (input.firm.previousFyTurnover === null) {
    add({ code: "TURNOVER_NOT_CONFIGURED", severity: "WARNING", blocking: true, jsonOnly: true, message: "Aggregate turnover of the preceding financial year (GSTR-1 table 3.a) is not configured, so it is blank in the Excel and the JSON cannot be completed.", fix: "Add it under Settings → GST (setting gst_turnover_prev_fy)." });
  }
  if (input.firm.aatoBand === null) {
    add({ code: "AATO_BAND_NOT_CONFIGURED", severity: "WARNING", message: `Turnover band (up to / above ₹5 crore) is not configured; HSN codes are checked for at least ${sec.rules.hsnMinDigits} digits only.`, fix: "Set gst_aato_band to UPTO_5CR or ABOVE_5CR (6-digit HSN is mandatory above ₹5 crore)." });
  }

  const seen = new Map<string, GstDoc>();
  for (const c of sec.contexts) {
    const { doc } = c;
    const w = where(c);

    // ---- duplicates ---------------------------------------------------------------------------
    const dupKey = `${doc.kind}|${doc.number.trim().toUpperCase()}`;
    const prior = seen.get(dupKey);
    if (prior) add({ code: "DUPLICATE_NUMBER", severity: "ERROR", message: `${label(doc)} appears more than once in this period (also ${prior.date}).`, fix: "Each document number must be unique; correct or cancel the duplicate.", ...w });
    else seen.set(dupKey, doc);

    if (doc.status === "CANCELLED") continue; // cancelled documents only count in table 13

    // ---- number & date ----------------------------------------------------------------------
    if (!doc.number.trim()) add({ code: "NUMBER_MISSING", severity: "ERROR", message: `A ${label(doc)} has no number.`, ...w });
    else if (!INVOICE_NO.test(doc.number.trim())) add({ code: "NUMBER_INVALID", severity: "ERROR", message: `${label(doc)}: the portal accepts up to 16 letters, digits, "/" and "-", not starting with 0, "/" or "-".`, fix: "Renumber the document.", ...w });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) add({ code: "DATE_INVALID", severity: "ERROR", message: `${label(doc)} has an invalid date.`, ...w });
    else if (doc.date > today) add({ code: "DATE_IN_FUTURE", severity: "ERROR", message: `${label(doc)} is dated ${doc.date}, in the future.`, ...w });
    if (doc.lines.length === 0) add({ code: "NO_LINES", severity: "ERROR", message: `${label(doc)} has no line items.`, ...w });
    if (doc.kind === "INVOICE" && doc.totals.total < 0) add({ code: "NEGATIVE_INVOICE", severity: "ERROR", message: `${label(doc)} has a negative total; use a credit note for reductions.`, ...w });
    if (doc.totals.total === 0) add({ code: "ZERO_VALUE_DOCUMENT", severity: "INFO", message: `${label(doc)} has a zero value.`, ...w });

    // ---- recipient ---------------------------------------------------------------------------------
    const gstin = doc.party.gstin?.trim() ?? "";
    const needsGstin = c.section === "B2B" || c.section === "CDNR";
    if (gstin) {
      const check = checkGstin(gstin);
      if (check !== "OK") {
        add({
          code: "GSTIN_INVALID", severity: "ERROR", field: "party.gstin",
          message: `${label(doc)}: ${doc.party.name}'s GSTIN "${gstin}" is invalid (${check === "BAD_CHECK_DIGIT" ? "check digit does not match — likely a typing error" : check === "BAD_STATE" ? "unknown state code" : "wrong format"}). The portal rejects it.`,
          fix: "Correct the customer's GSTIN (confirm it from the GST portal).", ...w,
        });
      }
      if (doc.party.treatment === "UNREGISTERED") add({ code: "TREATMENT_CONFLICT", severity: "ERROR", message: `${label(doc)}: ${doc.party.name} is marked unregistered but has a GSTIN.`, fix: "Fix the customer's GST treatment or remove the GSTIN.", ...w });
    } else {
      if (doc.party.treatment === "REGISTERED" || c.isSezOrDeemed) add({ code: "GSTIN_MISSING", severity: "ERROR", field: "party.gstin", message: `${label(doc)}: ${doc.party.name} is ${c.isSezOrDeemed ? "an SEZ/deemed-export recipient" : "marked registered"} but no GSTIN is recorded.`, fix: "Enter the customer's GSTIN.", ...w });
      else if (needsGstin) add({ code: "GSTIN_MISSING", severity: "ERROR", field: "party.gstin", message: `${label(doc)} is a B2B document without a GSTIN.`, ...w });
    }
    if (c.isExport && gstin) add({ code: "EXPORT_WITH_GSTIN", severity: "WARNING", message: `${label(doc)} is an export but the recipient has a GSTIN.`, ...w });

    // ---- place of supply -----------------------------------------------------------------------------
    const posNeeded = c.section !== "NIL_ONLY";
    if (!c.posCode) {
      if (posNeeded) add({ code: "POS_MISSING", severity: "ERROR", field: "placeOfSupply", message: `${label(doc)} (${doc.party.name}): place of supply is not recorded${doc.placeOfSupplyName ? ` ("${doc.placeOfSupplyName}" is not a recognised state)` : ""}, so it cannot be placed correctly in the return.`, fix: "Set the place of supply (state) on the invoice.", ...w });
    } else if (!posLabel(c.posCode)) {
      add({ code: "POS_INVALID", severity: "ERROR", message: `${label(doc)}: place of supply code ${c.posCode} is not on the portal's list.`, ...w });
    }

    // ---- tax type vs place of supply ---------------------------------------------------------------------
    const linesIgst = r2(doc.lines.reduce((n, l) => n + l.igst, 0));
    const linesCs = r2(doc.lines.reduce((n, l) => n + l.cgst + l.sgst, 0));
    const zeroTaxSupply = doc.supplyType === "SEZ_WITHOUT_PAYMENT" || doc.supplyType === "EXPORT_WITHOUT_PAYMENT";
    if (c.posCode && !c.isExport && !c.isSezOrDeemed) {
      if (c.interState && linesCs > 0.005) add({ code: "TAX_TYPE_MISMATCH", severity: "ERROR", message: `${label(doc)}: place of supply ${posLabel(c.posCode)} is outside your state but CGST/SGST was charged instead of IGST.`, fix: "Correct the place of supply or the tax type.", ...w });
      if (!c.interState && linesIgst > 0.005) add({ code: "TAX_TYPE_MISMATCH", severity: "ERROR", message: `${label(doc)}: place of supply ${posLabel(c.posCode)} is in your state but IGST was charged.`, fix: "Correct the place of supply or the tax type.", ...w });
    }
    if (c.posCode && c.registered && stateCodeFromGstin(gstin) && stateCodeFromGstin(gstin) !== c.posCode && !c.isExport) {
      add({ code: "POS_DIFFERS_FROM_GSTIN_STATE", severity: "INFO", message: `${label(doc)}: place of supply (${posLabel(c.posCode)}) differs from the recipient GSTIN's state; fine for bill-to/ship-to cases, otherwise check it.`, ...w });
    }

    // ---- lines --------------------------------------------------------------------------------------------------
    for (const l of doc.lines) {
      const at = `${label(doc)} line ${l.lineNo} "${l.description.slice(0, 32)}"`;
      const field = `lines.${l.lineNo}`;
      const wl = { ...w, lineId: l.lineId, productId: l.productId ?? null, lineDescription: l.description };
      const hsn = (l.hsn ?? "").trim();
      if (!hsn) add({ code: "HSN_MISSING", severity: "ERROR", field: `${field}.hsn`, message: `${at}: HSN/SAC code is missing (₹${l.taxable.toFixed(2)} taxable).`, fix: "Enter the HSN/SAC code for this item.", ...wl });
      else if (!/^\d+$/.test(hsn) || !HSN_LENGTHS.has(hsn.length)) add({ code: "HSN_INVALID", severity: "ERROR", field: `${field}.hsn`, message: `${at}: HSN "${hsn}" is not a valid 2, 4, 6 or 8 digit code.`, ...wl });
      else if (hsn.length < sec.rules.hsnMinDigits) add({ code: "HSN_TOO_SHORT", severity: input.firm.aatoBand === null ? "WARNING" : "ERROR", field: `${field}.hsn`, message: `${at}: HSN "${hsn}" has ${hsn.length} digits; at least ${sec.rules.hsnMinDigits} are required${input.firm.aatoBand === null ? " (turnover band not configured, so this is the minimum for the smaller band)" : ""}.`, fix: "Enter the full HSN code.", ...wl });
      if (!normaliseUqc(l.uqc)) add({ code: "UQC_INVALID", severity: "ERROR", field: `${field}.uqc`, message: `${at}: unit "${l.uqc ?? ""}" is not an official Unit Quantity Code.`, fix: "Set the product's unit to an official UQC (e.g. PCS, NOS, KGS).", ...wl });
      if (l.rate === null) add({ code: "RATE_MISSING", severity: "ERROR", field: `${field}.rate`, message: `${at}: GST rate is missing.`, ...wl });
      else if (!isValidRate(l.rate)) add({ code: "RATE_INVALID", severity: "ERROR", field: `${field}.rate`, message: `${at}: ${l.rate}% is not a rate the portal accepts.`, ...wl });
      else if (l.rate === 0 && l.taxability === "TAXABLE" && l.taxable !== 0) add({ code: "ZERO_RATE_TAXABLE", severity: "WARNING", field: `${field}.taxability`, message: `${at}: ₹${l.taxable.toFixed(2)} is taxable at 0%. If it is nil-rated, exempted or non-GST, classify the line so it goes to table 8.`, fix: "Set the line's taxability (nil-rated / exempted / non-GST).", ...wl });
      const tax = l.igst + l.cgst + l.sgst;
      if (l.taxability !== "TAXABLE" && tax > 0.005) add({ code: "TAX_ON_NON_TAXABLE", severity: "ERROR", message: `${at} is marked ${l.taxability.replace("_", "-").toLowerCase()} but carries tax.`, ...wl });
      if (l.rate !== null && l.taxability === "TAXABLE" && !zeroTaxSupply) {
        const expectedTax = (l.taxable * l.rate) / 100;
        if (Math.abs(expectedTax - tax) > TOL_LINE) add({ code: "TAX_CALC_MISMATCH", severity: "ERROR", field: `${field}.tax`, message: `${at}: ${l.rate}% of ₹${l.taxable.toFixed(2)} is ₹${expectedTax.toFixed(2)} but tax recorded is ₹${tax.toFixed(2)}.`, ...wl });
        if (Math.abs(l.cgst - l.sgst) > TOL_LINE) add({ code: "CGST_SGST_UNEQUAL", severity: "ERROR", message: `${at}: CGST ₹${l.cgst.toFixed(2)} and SGST ₹${l.sgst.toFixed(2)} differ.`, ...wl });
      }
      if (l.quantity <= 0 && doc.kind === "INVOICE") add({ code: "QUANTITY_INVALID", severity: "WARNING", message: `${at}: quantity ${l.quantity}.`, ...wl });
    }

    // ---- header vs lines ----------------------------------------------------------------------------------------
    const tolHeader = 0.05 * Math.max(1, doc.lines.length);
    const lineSum = (k: "taxable" | "cgst" | "sgst" | "igst" | "cess") => r2(doc.lines.reduce((n, l) => n + l[k], 0));
    for (const [k, header] of [["taxable", doc.totals.taxable], ["cgst", doc.totals.cgst], ["sgst", doc.totals.sgst], ["igst", doc.totals.igst], ["cess", doc.totals.cess]] as const) {
      if (doc.lines.length && Math.abs(lineSum(k) - header) > tolHeader) add({ code: "HEADER_LINES_MISMATCH", severity: "ERROR", field: `totals.${k}`, message: `${label(doc)}: ${k.toUpperCase()} on the document is ₹${header.toFixed(2)} but its lines add up to ₹${lineSum(k).toFixed(2)}.`, ...w });
    }
    const componentSum = r2(doc.totals.taxable + doc.totals.cgst + doc.totals.sgst + doc.totals.igst + doc.totals.cess + doc.totals.roundOff);
    if (Math.abs(componentSum - doc.totals.total) > Math.max(0.02, tolHeader)) add({ code: "TOTAL_MISMATCH", severity: "ERROR", field: "totals.total", message: `${label(doc)}: total ₹${doc.totals.total.toFixed(2)} ≠ taxable + tax + round-off (₹${componentSum.toFixed(2)}).`, ...w });
    if (Math.abs(doc.totals.roundOff) >= 1) add({ code: "ROUND_OFF_LARGE", severity: "WARNING", message: `${label(doc)} has a round-off of ₹${doc.totals.roundOff.toFixed(2)}.`, ...w });

    // ---- document-type specific ------------------------------------------------------------------------------------
    if (c.section === "B2CL" && c.registered) add({ code: "B2CL_WITH_GSTIN", severity: "WARNING", message: `${label(doc)} is large but the recipient has a GSTIN.`, ...w });
    if (doc.reverseCharge && !c.registered) add({ code: "RCM_UNREGISTERED", severity: "WARNING", message: `${label(doc)}: reverse charge applies but the recipient is unregistered.`, ...w });
    if (c.isExport) {
      const e = doc.exportDetails;
      if (!e?.portCode || !e?.shippingBillNumber || !e?.shippingBillDate) add({ code: "EXPORT_DETAILS_MISSING", severity: "WARNING", message: `${label(doc)}: port code / shipping bill number / date are not all recorded.`, fix: "Add the shipping bill details once available.", ...w });
    }
    if (doc.kind !== "INVOICE") {
      if (!doc.original?.number) add({ code: "NOTE_REFERENCE_MISSING", severity: "WARNING", message: `${label(doc)} does not name the invoice it relates to.`, fix: "Record the original invoice number and date.", ...w });
      else if (doc.original.date && doc.date < doc.original.date) add({ code: "NOTE_BEFORE_INVOICE", severity: "ERROR", message: `${label(doc)} (${doc.date}) is dated before its invoice ${doc.original.number} (${doc.original.date}).`, ...w });
      else if (!doc.original.foundInErp) add({ code: "NOTE_INVOICE_NOT_IN_ERP", severity: "INFO", message: `${label(doc)} refers to invoice ${doc.original.number}, which is not in this ERP.`, ...w });
    }
  }

  // ---- table 13 completeness ---------------------------------------------------------------------------------
  for (const s of sec.docs) {
    if (s.missing.length) {
      const shown = s.missing.slice(0, 8).join(", ") + (s.missing.length > 8 ? ` … (${s.missing.length} in all)` : "");
      add({ code: "SERIES_GAP", severity: "ERROR", message: `${s.nature} ${s.from}–${s.to}: number${s.missing.length > 1 ? "s" : ""} ${shown} ${s.missing.length > 1 ? "are" : "is"} neither issued nor recorded as cancelled. Table 13 must account for every number.`, fix: "Find the missing document: record it (if it was issued) or cancel it (if it was voided)." });
    }
  }

  // ---- period ---------------------------------------------------------------------------------------------------------
  if (input.period.from.slice(0, 7) !== input.period.to.slice(0, 7)) {
    add({ code: "PERIOD_NOT_A_MONTH", severity: "WARNING", blocking: true, jsonOnly: true, message: "The portal JSON is for a single tax period (one month). A custom range spanning several months can be exported to Excel but not as portal JSON.", fix: "Choose a single month for the JSON." });
  }

  const order: Record<string, number> = { ERROR: 0, WARNING: 1, INFO: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.docNumber && b.docNumber ? naturalCompare(a.docNumber, b.docNumber) : 0));
}
