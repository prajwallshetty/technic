/**
 * Framework-free types for the GSTR-1 engine. The engine takes normalised
 * documents (built from real ERP records by the loader) and returns the
 * sections, validation findings and reconciliation — it never reads a
 * database and never invents a value.
 */

export type DocKind = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
export type DocStatus = "ISSUED" | "CANCELLED";
export type SupplyType =
  | "REGULAR"
  | "SEZ_WITH_PAYMENT"
  | "SEZ_WITHOUT_PAYMENT"
  | "DEEMED_EXPORT"
  | "EXPORT_WITH_PAYMENT"
  | "EXPORT_WITHOUT_PAYMENT";
export type Taxability = "TAXABLE" | "NIL_RATED" | "EXEMPTED" | "NON_GST";
export type GstTreatment = "REGISTERED" | "UNREGISTERED" | "SEZ" | "DEEMED_EXPORT" | "OVERSEAS" | "UIN_HOLDER" | "COMPOSITION";

export interface GstLine {
  lineNo: number;
  /** Database id of the line, so a correction can target it. */
  lineId?: string;
  productId?: string | null;
  description: string;
  hsn: string | null;
  /** Raw unit as stored (e.g. "pcs"); normalised to an official UQC by the engine. */
  uqc: string | null;
  quantity: number;
  /** Combined GST rate in percent (the IGST rate, or CGST + SGST). */
  rate: number | null;
  cessRate: number;
  taxability: Taxability;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  /** Line total as stored (taxable + tax). */
  total: number;
}

export interface GstDoc {
  kind: DocKind;
  id: string;
  number: string;
  /** yyyy-mm-dd, in India time. */
  date: string;
  status: DocStatus;
  party: { name: string; gstin: string | null; treatment: GstTreatment | null };
  supplyType: SupplyType;
  placeOfSupplyName: string | null;
  placeOfSupplyCode: string | null;
  reverseCharge: boolean;
  ecommerceGstin: string | null;
  exportDetails: { portCode: string | null; shippingBillNumber: string | null; shippingBillDate: string | null } | null;
  /** The invoice a credit/debit note refers to. */
  original: { number: string | null; date: string | null; foundInErp: boolean } | null;
  totals: { subtotal: number; discount: number; taxable: number; cgst: number; sgst: number; igst: number; cess: number; roundOff: number; total: number };
  lines: GstLine[];
  /** App path for jumping to the document to correct it. */
  link: string;
}

export interface GstAdvance {
  id: string;
  number: string;
  date: string;
  status: "RECEIVED" | "CANCELLED";
  placeOfSupplyCode: string | null;
  placeOfSupplyName: string | null;
  rate: number;
  cessRate: number;
  grossAmount: number;
  link: string;
}

export interface GstAdvanceAdjustment {
  advanceId: string;
  invoiceId: string;
  amount: number;
  date: string;
}

export interface FirmGstProfile {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  stateCode: string | null;
  /** Aggregate turnover band; decides the minimum HSN digits. Null = not configured. */
  aatoBand: "UPTO_5CR" | "ABOVE_5CR" | null;
  /** Aggregate turnover of the preceding financial year (₹); null = not configured. */
  previousFyTurnover: number | null;
  /** Cumulative turnover of the current FY up to the period (₹); null = not configured. */
  currentFyTurnover: number | null;
}

export interface Period {
  from: string; // yyyy-mm-dd
  to: string;
  /** "September 2026 - September 2026" */
  label: string;
  /** Portal filing period "092026" (month of `from`). */
  fp: string;
}

export interface GstrInput {
  firm: FirmGstProfile;
  period: Period;
  /** Documents dated within the period (cancelled ones included, for the docs table). */
  docs: GstDoc[];
  advances: GstAdvance[];
  adjustments: GstAdvanceAdjustment[];
  /**
   * Sales-register figures taken straight from the ERP's header totals by an
   * independent query (not from the lines the engine reads), so the two can be
   * compared. Excludes cancelled documents.
   */
  register: { invoices: RegisterTotals; creditNotes: RegisterTotals; debitNotes: RegisterTotals } | null;
  /** Line-level sums from a database aggregation (invoices net of notes), a second path to the same totals. */
  gstSummary: { taxable: number; cgst: number; sgst: number; igst: number } | null;
  /** The date "today" for future-date checks (yyyy-mm-dd); injected for deterministic tests. */
  today?: string;
}

export interface RegisterTotals {
  count: number;
  total: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export type Severity = "ERROR" | "WARNING" | "INFO";

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  /** Document the issue concerns, when there is one. */
  docId?: string;
  docNumber?: string;
  docKind?: DocKind;
  link?: string;
  field?: string;
  /** What to change, in plain words. */
  fix?: string;
  /** True when the Excel/JSON is wrong or will be rejected unless this is corrected. */
  blocking: boolean;
  /** The finding only blocks the portal JSON; the Excel is still correct. */
  jsonOnly?: boolean;
  /** The line (and its product) the finding concerns, when it is about one line. */
  lineId?: string;
  productId?: string | null;
  lineDescription?: string;
}

// ----- output rows ------------------------------------------------------------------

export interface RateRow {
  rate: number;
  cessRate: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface ReportRow {
  gstin: string;
  partyName: string;
  txnType: "Sale" | "Credit Note" | "Debit Note";
  number: string;
  date: string;
  value: number;
  rate: number;
  cessRate: number;
  taxable: number;
  reverseCharge: "Y" | "N";
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  posName: string;
  docId: string;
}

export interface B2bRow {
  gstin: string;
  name: string;
  number: string;
  date: string;
  value: number;
  pos: string;
  reverseCharge: "Y" | "N";
  applicablePct: number | null;
  invoiceType: string;
  ecommerceGstin: string;
  rate: number;
  taxable: number;
  cess: number;
  igst: number;
  cgst: number;
  sgst: number;
  supplyType: SupplyType;
  docId: string;
}

export interface B2clRow {
  number: string;
  date: string;
  value: number;
  pos: string;
  rate: number;
  taxable: number;
  cess: number;
  igst: number;
  ecommerceGstin: string;
  docId: string;
}

export interface B2csRow {
  type: "OE" | "E";
  pos: string;
  rate: number;
  taxable: number;
  cess: number;
  igst: number;
  cgst: number;
  sgst: number;
  ecommerceGstin: string;
}

export interface CdnrRow {
  gstin: string;
  name: string;
  number: string;
  date: string;
  noteType: "C" | "D";
  pos: string;
  reverseCharge: "Y" | "N";
  supplyType: string;
  value: number;
  rate: number;
  taxable: number;
  cess: number;
  igst: number;
  cgst: number;
  sgst: number;
  invoiceType: SupplyType;
  originalNumber: string | null;
  originalDate: string | null;
  docId: string;
}

export interface CdnurRow {
  urType: "B2CL" | "EXPWP" | "EXPWOP";
  number: string;
  date: string;
  noteType: "C" | "D";
  pos: string;
  value: number;
  rate: number;
  taxable: number;
  cess: number;
  igst: number;
  docId: string;
}

export interface ExpRow {
  exportType: "WPAY" | "WOPAY";
  number: string;
  date: string;
  value: number;
  portCode: string;
  shippingBillNumber: string;
  shippingBillDate: string;
  rate: number;
  taxable: number;
  igst: number;
  cess: number;
  docId: string;
}

export interface AdvanceRow {
  pos: string;
  rate: number;
  amount: number;
  cess: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface ExempBucket {
  key: "INTER_REG" | "INTRA_REG" | "INTER_UNREG" | "INTRA_UNREG";
  nil: number;
  exempted: number;
  nonGst: number;
}

export interface HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  quantity: number;
  value: number;
  rate: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

/** Header totals of a Table 12 sheet, accumulated unrounded (as the portal and Vyapar do). */
export interface HsnTotals {
  value: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface DocSeriesRow {
  nature: "Invoices for outward supply" | "Credit Note" | "Debit Note";
  from: string;
  to: string;
  total: number;
  cancelled: number;
  /** Numbers missing from the continuous range (neither issued nor recorded as cancelled). */
  missing: string[];
}

export interface Gstr1Report {
  firm: FirmGstProfile;
  period: Period;
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
  issues: Issue[];
  reconciliation: ReconciliationLine[];
  /** Totals of everything reported, by section — drives the preview cards. */
  totals: SectionTotals;
  rulesApplied: { b2clThreshold: number; hsnMinDigits: number; hsnSplit: boolean };
}

export interface SectionTotals {
  invoiceCount: number;
  noteCount: number;
  cancelledCount: number;
  b2b: { invoices: number; recipients: number; value: number; taxable: number; cess: number };
  b2cl: { invoices: number; value: number; taxable: number; cess: number };
  b2cs: { taxable: number; cess: number };
  cdnr: { notes: number; recipients: number; value: number; taxable: number; cess: number };
  cdnur: { notes: number; value: number; taxable: number; cess: number };
  exp: { invoices: number; value: number; taxable: number; shippingBills: number };
  at: { amount: number; cess: number };
  atadj: { amount: number; cess: number };
  exemp: { nil: number; exempted: number; nonGst: number };
  /** Net of credit notes (and plus debit notes), as shown in the report's Total row. */
  net: { value: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number };
}

export interface ReconciliationLine {
  key: string;
  label: string;
  /** What the return reports. */
  reported: number | null;
  /** The independent figure it is compared with. */
  expected: number | null;
  difference: number | null;
  ok: boolean | null;
  /** Where `expected` comes from. */
  source: string;
  note?: string;
}
