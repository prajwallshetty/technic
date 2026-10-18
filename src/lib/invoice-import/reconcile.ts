import type { DraftInvoice } from "./draft";
import { gstinStateCode, isValidGstin, nearlyEqual, round2 } from "./normalize";
import type { ExtractionIssue } from "./types";

/**
 * Financial reconciliation. Recomputes the invoice from its line items —
 * independently of the printed totals — and compares every printed figure
 * against the recomputation. Nothing here changes a value: discrepancies are
 * reported for a human to resolve.
 */

export interface CalculatedTotals {
  lineSum: number;
  grossAmount: number;
  discountAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  charges: number;
  totalBeforeRound: number;
  roundOff: number;
  grandTotal: number;
  interState: boolean | null;
  /** False when a needed input (e.g. a line's GST rate) was missing. */
  complete: boolean;
}

export interface ReconciliationCheck {
  code: string;
  label: string;
  printed: number | null;
  calculated: number | null;
  difference: number | null;
  ok: boolean | null; // null = could not be evaluated
}

export interface ReconciliationResult {
  calculated: CalculatedTotals;
  checks: ReconciliationCheck[];
  issues: ExtractionIssue[];
  /** Printed grand total minus independently calculated grand total. */
  grandTotalDifference: number | null;
}

export interface ReconcileOptions {
  firmGstin: string | null;
  /** Today's date (yyyy-mm-dd); injected for deterministic tests. */
  today?: string;
}

const TAX_TOLERANCE = 0.05; // per-rate rounding on printed CGST/SGST
const AMOUNT_TOLERANCE = 0.02;

export function reconcile(draft: DraftInvoice, options: ReconcileOptions): ReconciliationResult {
  const issues: ExtractionIssue[] = [];
  const checks: ReconciliationCheck[] = [];
  const t = draft.totals;
  let complete = true;

  // ---- Required fields ---------------------------------------------------
  const required: Array<[keyof DraftInvoice, string]> = [
    ["invoiceNumber", "Invoice number"],
    ["invoiceDate", "Invoice date"],
    ["partyName", draft.direction === "PURCHASE" ? "Supplier name" : "Customer name"],
  ];
  for (const [key, label] of required) {
    if (!draft[key]) issues.push({ code: "REQUIRED_FIELD_MISSING", severity: "ERROR", message: `${label} is missing`, field: key });
  }
  if (t.grandTotal === null) {
    issues.push({ code: "REQUIRED_FIELD_MISSING", severity: "ERROR", message: "Grand total is missing", field: "totals.grandTotal" });
  }
  if (draft.lines.length === 0) {
    issues.push({ code: "REQUIRED_FIELD_MISSING", severity: "ERROR", message: "Invoice has no line items", field: "lines" });
  }
  if (draft.direction === "UNKNOWN") {
    issues.push({
      code: "DIRECTION_UNKNOWN",
      severity: "ERROR",
      message: "Not known whether this is a sales or a purchase invoice — neither GSTIN matches this firm",
      field: "direction",
    });
  }
  for (const line of draft.lines) {
    const path = `lines.${line.lineNo}`;
    if (!line.description) issues.push({ code: "LINE_DESCRIPTION_MISSING", severity: "ERROR", message: `Line ${line.lineNo}: description is missing`, field: `${path}.description` });
    if (line.amount === null) issues.push({ code: "LINE_AMOUNT_MISSING", severity: "ERROR", message: `Line ${line.lineNo}: amount is missing`, field: `${path}.amount` });
    if (line.kind === "ITEM" && line.quantity === null) {
      issues.push({ code: "LINE_QUANTITY_MISSING", severity: "ERROR", message: `Line ${line.lineNo}: quantity is missing`, field: `${path}.quantity` });
    }
  }
  if (!draft.currency) {
    issues.push({ code: "CURRENCY_UNKNOWN", severity: "WARNING", message: "Currency could not be determined", field: "currency" });
  } else if (draft.currency !== "INR") {
    issues.push({ code: "FOREIGN_CURRENCY", severity: "ERROR", message: `Currency ${draft.currency} is not supported by the ERP (INR only)`, field: "currency" });
  }

  // ---- Dates -------------------------------------------------------------------
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (draft.invoiceDate && draft.invoiceDate > today) {
    issues.push({ code: "DATE_IN_FUTURE", severity: "ERROR", message: `Invoice date ${draft.invoiceDate} is in the future`, field: "invoiceDate" });
  }

  // ---- GSTINs ------------------------------------------------------------------
  for (const [key, value] of [["partyGstin", draft.partyGstin], ["issuerGstin", draft.issuerGstin]] as const) {
    if (value && !isValidGstin(value)) {
      issues.push({
        code: "GSTIN_INVALID",
        severity: "WARNING",
        message: `GSTIN ${value} fails the GSTIN format/check-digit validation (possible typo on the source document)`,
        field: key,
      });
    }
  }
  if (draft.direction === "SALES" && !draft.partyGstin) {
    issues.push({ code: "PARTY_GSTIN_MISSING", severity: "INFO", message: "Customer GSTIN is not printed (B2C or unregistered buyer)", field: "partyGstin" });
  }

  // ---- Lines -------------------------------------------------------------------
  let lineSum = 0;
  const taxableByRate = new Map<number, number>();
  for (const line of draft.lines) {
    const path = `lines.${line.lineNo}`;
    if (line.amount === null) {
      complete = false;
      continue;
    }
    lineSum += line.amount;
    if (line.quantity !== null && line.rate !== null) {
      const expected = round2(line.quantity * line.rate * (1 - (line.discountPercent ?? 0) / 100));
      const tolerance = Math.max(AMOUNT_TOLERANCE, Math.abs(line.quantity) * 0.005);
      if (!nearlyEqual(expected, line.amount, tolerance)) {
        issues.push({
          code: "LINE_AMOUNT_MISMATCH",
          severity: "ERROR",
          message: `Line ${line.lineNo}: quantity × rate = ${expected.toFixed(2)} but amount is ${line.amount.toFixed(2)}`,
          field: `${path}.amount`,
          details: { expected, printed: line.amount },
        });
      }
    }
    if (line.kind === "ITEM" && line.amount === 0) {
      issues.push({
        code: "LINE_ZERO_VALUE",
        severity: "INFO",
        message: `Line ${line.lineNo}: zero-value item (free/replacement unit?)`,
        field: `${path}.amount`,
      });
    }
    if (line.kind === "ITEM" && line.quantity !== null && line.quantity <= 0) {
      issues.push({ code: "LINE_QUANTITY_INVALID", severity: "ERROR", message: `Line ${line.lineNo}: quantity must be positive`, field: `${path}.quantity` });
    }
    if (line.gstRate === null) {
      complete = false;
    } else {
      taxableByRate.set(line.gstRate, (taxableByRate.get(line.gstRate) ?? 0) + line.amount);
    }
  }
  lineSum = round2(lineSum);

  // ---- Header discount and taxable value ---------------------------------
  const gross = lineSum;
  const discountAmount = t.discountAmount ?? 0;
  if (t.discountAmount !== null && t.discountPercent !== null && t.grossAmount) {
    // The printed % is rounded for display; the printed amount is authoritative.
    const effective = (t.discountAmount / t.grossAmount) * 100;
    if (Math.abs(effective - t.discountPercent) > 0.5) {
      issues.push({
        code: "DISCOUNT_PERCENT_MISMATCH",
        severity: "WARNING",
        message: `Discount ${t.discountAmount.toFixed(2)} is ${effective.toFixed(2)}% of gross, but ${t.discountPercent}% is printed`,
        field: "totals.discountAmount",
      });
    }
  }
  const taxable = round2(gross - discountAmount);

  // ---- Tax -------------------------------------------------------------------------
  const firmState = gstinStateCode(options.firmGstin);
  const counterState = gstinStateCode(draft.direction === "PURCHASE" ? draft.issuerGstin : draft.partyGstin);
  let interState: boolean | null = firmState && counterState ? firmState !== counterState : null;
  const printedIsIgst = (t.igst ?? 0) !== 0 && !(t.cgst || t.sgst);
  if (interState === null && (t.igst !== null || t.cgst !== null)) {
    interState = printedIsIgst;
    issues.push({
      code: "PLACE_OF_SUPPLY_INFERRED",
      severity: "INFO",
      message: `Counterparty state unknown (no GSTIN); ${printedIsIgst ? "IGST" : "CGST+SGST"} taken from the printed tax lines`,
      field: "placeOfSupply",
    });
  } else if (interState !== null && (t.igst !== null || t.cgst !== null) && interState !== printedIsIgst) {
    issues.push({
      code: "TAX_TYPE_MISMATCH",
      severity: "ERROR",
      message: `GSTIN states (${firmState} vs ${counterState}) imply ${interState ? "IGST" : "CGST+SGST"} but the invoice charges ${printedIsIgst ? "IGST" : "CGST+SGST"}`,
      field: "totals",
    });
  }

  // Header discount is spread proportionally across rates.
  const scale = gross !== 0 ? taxable / gross : 1;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const [rate, base] of taxableByRate) {
    const rateTaxable = base * scale;
    if (interState) igst += round2((rateTaxable * rate) / 100);
    else {
      cgst += round2((rateTaxable * rate) / 200);
      sgst += round2((rateTaxable * rate) / 200);
    }
  }
  cgst = round2(cgst);
  sgst = round2(sgst);
  igst = round2(igst);
  const charges = round2((t.freight ?? 0) + (t.packing ?? 0) + (t.otherCharges ?? 0) + (t.cess ?? 0));
  const totalBeforeRound = round2(taxable + cgst + sgst + igst + charges);
  const grandTotal = Math.round(totalBeforeRound);
  const roundOff = round2(grandTotal - totalBeforeRound);

  const calculated: CalculatedTotals = {
    lineSum,
    grossAmount: gross,
    discountAmount: round2(discountAmount),
    taxableAmount: taxable,
    cgst,
    sgst,
    igst,
    charges,
    totalBeforeRound,
    roundOff,
    grandTotal,
    interState,
    complete,
  };

  // ---- Printed vs calculated --------------------------------------------------
  const compare = (code: string, label: string, printed: number | null, calc: number | null, tolerance: number, severity: "ERROR" | "WARNING", fieldPath: string) => {
    const evaluable = printed !== null && calc !== null;
    const difference = evaluable ? round2(printed - calc) : null;
    const ok = evaluable ? Math.abs(difference!) <= tolerance + 1e-9 : null;
    checks.push({ code, label, printed, calculated: calc, difference, ok });
    if (ok === false) {
      issues.push({
        code,
        severity,
        message: `${label}: printed ${printed!.toFixed(2)} vs calculated ${calc!.toFixed(2)} (difference ${difference!.toFixed(2)})`,
        field: fieldPath,
        details: { printed, calculated: calc, difference },
      });
    }
  };

  compare("GROSS_MISMATCH", "Gross amount (sum of lines)", t.grossAmount, gross, AMOUNT_TOLERANCE, "ERROR", "totals.grossAmount");
  compare("TAXABLE_MISMATCH", "Taxable value (gross − discount)", t.taxableAmount, taxable, AMOUNT_TOLERANCE, "ERROR", "totals.taxableAmount");
  if (complete) {
    compare("CGST_MISMATCH", "CGST", t.cgst ?? (interState ? 0 : null), cgst, TAX_TOLERANCE, "ERROR", "totals.cgst");
    compare("SGST_MISMATCH", "SGST", t.sgst ?? (interState ? 0 : null), sgst, TAX_TOLERANCE, "ERROR", "totals.sgst");
    compare("IGST_MISMATCH", "IGST", t.igst ?? (interState ? null : 0), igst, TAX_TOLERANCE, "ERROR", "totals.igst");
    compare("GRAND_TOTAL_MISMATCH", "Grand total", t.grandTotal, grandTotal, 0, "ERROR", "totals.grandTotal");
  } else {
    issues.push({
      code: "RECALCULATION_INCOMPLETE",
      severity: "WARNING",
      message: "Tax and grand total could not be recalculated independently: a line amount or GST rate is missing",
      field: "lines",
    });
  }

  // Internal consistency of the printed totals block itself.
  if (t.grandTotal !== null && t.taxableAmount !== null) {
    const printedBeforeRound = round2(t.taxableAmount + (t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0) + charges);
    compare("ROUND_OFF_MISMATCH", "Round-off (printed total − printed components)", t.roundOff ?? 0, round2(t.grandTotal - printedBeforeRound), AMOUNT_TOLERANCE, "ERROR", "totals.roundOff");
  }
  if (t.roundOff !== null && Math.abs(t.roundOff) >= 1) {
    issues.push({ code: "ROUND_OFF_LARGE", severity: "WARNING", message: `Round-off of ${t.roundOff.toFixed(2)} is a rupee or more`, field: "totals.roundOff" });
  }
  if (draft.amountInWordsValue !== null || draft.amountInWords) {
    compare("AMOUNT_IN_WORDS_MISMATCH", "Amount in words", draft.amountInWordsValue, t.grandTotal, 0, "ERROR", "totals.grandTotal");
  }
  if (draft.taxRateSummary.length > 0) {
    // The printed rate table lists only taxable rates (no 0% row), so compare
    // rate by rate against the line items rather than against the total.
    for (const row of draft.taxRateSummary) {
      if (row.taxableValue === 0 && !taxableByRate.has(row.ratePercent)) continue;
      const calcTaxable = complete ? round2((taxableByRate.get(row.ratePercent) ?? 0) * scale) : null;
      compare("RATE_SUMMARY_TAXABLE_MISMATCH", `Rate summary ${row.ratePercent}% taxable value`, row.taxableValue, calcTaxable, AMOUNT_TOLERANCE * 5, "WARNING", "totals.taxableAmount");
    }
    const sum = (key: "cgst" | "sgst" | "igst") => round2(draft.taxRateSummary.reduce((n, r) => n + r[key], 0));
    compare("RATE_SUMMARY_TAX_MISMATCH", "Rate summary tax total", round2(sum("cgst") + sum("sgst") + sum("igst")), round2((t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0)), TAX_TOLERANCE, "WARNING", "totals");
  }

  const grandCheck = checks.find((c) => c.code === "GRAND_TOTAL_MISMATCH");
  return { calculated, checks, issues, grandTotalDifference: grandCheck?.difference ?? null };
}
