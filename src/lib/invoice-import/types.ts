/**
 * Shared types for the bulk invoice import pipeline.
 *
 * Everything in src/lib/invoice-import is framework-free (no Prisma, no
 * "server-only") so the same extraction code runs inside the ERP worker, the
 * CLI report script and the test suite.
 */

export type Confidence = number; // 0..1

export type DocumentDirection = "SALES" | "PURCHASE" | "UNKNOWN";

export type ExtractionMethod = "PDF_TEXT" | "OCR";

export type IssueSeverity = "ERROR" | "WARNING" | "INFO";

export interface ExtractionIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** Dotted path of the field the issue concerns, e.g. "totals.grandTotal" or "lines.3.rate". */
  field?: string;
  details?: Record<string, unknown>;
}

/** A value read from the document together with how sure we are about it. */
export interface Field<T> {
  value: T | null;
  confidence: Confidence;
  /** Verbatim text the value was read from — preserved for audit and review. */
  raw?: string | null;
}

export interface PartyDetails {
  name: Field<string>;
  addressLines: string[];
  gstin: Field<string>;
  phone: Field<string>;
  email: Field<string>;
  stateCode: string | null;
}

export interface TaxRateSummaryRow {
  ratePercent: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export type ExtractedLineKind = "ITEM" | "ADJUSTMENT";

export interface ExtractedLine {
  lineNo: number;
  kind: ExtractedLineKind;
  description: Field<string>;
  hsn: Field<string>;
  sku: Field<string>;
  barcode: Field<string>;
  brand: Field<string>;
  quantity: Field<number>;
  unit: Field<string>;
  rate: Field<number>;
  discountPercent: Field<number>;
  gstRate: Field<number>;
  amount: Field<number>;
  /** All text on the source row(s), left to right, exactly as extracted. */
  rawText: string;
  page: number;
}

export interface ExtractedTotals {
  grossAmount: Field<number>;
  discountPercent: Field<number>;
  discountAmount: Field<number>;
  taxableAmount: Field<number>;
  cgst: Field<number>;
  sgst: Field<number>;
  igst: Field<number>;
  cess: Field<number>;
  freight: Field<number>;
  packing: Field<number>;
  otherCharges: Field<number>;
  roundOff: Field<number>;
  grandTotal: Field<number>;
  amountInWords: Field<string>;
  /** Grand total parsed independently from the "Amount in Words" line. */
  amountInWordsValue: number | null;
  taxRateSummary: TaxRateSummaryRow[];
}

export interface ExtractedInvoice {
  sourceFilename: string;
  layoutId: string;
  extractionMethod: ExtractionMethod;
  pageCount: number;
  documentType: Field<string>; // "TAX INVOICE", "BILL OF SUPPLY", ...
  direction: DocumentDirection;
  issuer: PartyDetails;
  recipient: PartyDetails;
  invoiceNumber: Field<string>;
  invoiceDate: Field<string>; // ISO yyyy-mm-dd
  dueDate: Field<string>;
  paymentTerms: Field<string>; // e.g. CASH / CREDIT
  purchaseOrderNumber: Field<string>;
  referenceNumbers: string[];
  dispatchThrough: Field<string>;
  ewayBillNumber: Field<string>;
  currency: Field<string>;
  placeOfSupply: Field<string>;
  lines: ExtractedLine[];
  totals: ExtractedTotals;
  issues: ExtractionIssue[];
  /** Whole-document text in reading order, preserved verbatim. */
  rawText: string;
}

/** Positioned text run from a PDF text layer. y grows upwards (PDF space). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

export interface DocumentText {
  method: ExtractionMethod;
  pageCount: number;
  pages: PageText[];
  /** Plain text in reading order; for OCR this is the only content available. */
  plainText: string;
}

export function emptyField<T>(): Field<T> {
  return { value: null, confidence: 0, raw: null };
}

export function field<T>(value: T | null, confidence: Confidence, raw?: string | null): Field<T> {
  return { value, confidence: value === null ? 0 : confidence, raw: raw ?? null };
}

export function emptyParty(): PartyDetails {
  return {
    name: emptyField(),
    addressLines: [],
    gstin: emptyField(),
    phone: emptyField(),
    email: emptyField(),
    stateCode: null,
  };
}
