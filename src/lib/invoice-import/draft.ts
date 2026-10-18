import type { DocumentDirection, ExtractedInvoice, ExtractedLineKind, TaxRateSummaryRow } from "./types";

/**
 * The editable, flat shape of an imported invoice. Extraction produces one
 * from the parsed document; reviewers edit it; validation and approval only
 * ever read this shape. The original extraction is stored separately and is
 * never overwritten.
 */
export interface DraftLine {
  lineNo: number;
  kind: ExtractedLineKind;
  description: string | null;
  hsn: string | null;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  discountPercent: number | null;
  gstRate: number | null;
  amount: number | null;
  rawText: string;
}

export interface DraftTotals {
  grossAmount: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  taxableAmount: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  cess: number | null;
  freight: number | null;
  packing: number | null;
  otherCharges: number | null;
  roundOff: number | null;
  grandTotal: number | null;
}

export interface DraftInvoice {
  direction: DocumentDirection;
  documentType: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // yyyy-mm-dd
  dueDate: string | null;
  paymentTerms: string | null;
  purchaseOrderNumber: string | null;
  dispatchThrough: string | null;
  ewayBillNumber: string | null;
  currency: string | null;
  placeOfSupply: string | null;
  issuerName: string | null;
  issuerGstin: string | null;
  /** The other party: the customer on a sales invoice, the supplier on a purchase invoice. */
  partyName: string | null;
  partyGstin: string | null;
  partyPhone: string | null;
  partyAddress: string | null;
  lines: DraftLine[];
  totals: DraftTotals;
  amountInWords: string | null;
  amountInWordsValue: number | null;
  taxRateSummary: TaxRateSummaryRow[];
}

export function draftFromExtraction(inv: ExtractedInvoice): DraftInvoice {
  const party = inv.direction === "PURCHASE" ? inv.issuer : inv.recipient;
  const t = inv.totals;
  return {
    direction: inv.direction,
    documentType: inv.documentType.value,
    invoiceNumber: inv.invoiceNumber.value,
    invoiceDate: inv.invoiceDate.value,
    dueDate: inv.dueDate.value,
    paymentTerms: inv.paymentTerms.value,
    purchaseOrderNumber: inv.purchaseOrderNumber.value,
    dispatchThrough: inv.dispatchThrough.value,
    ewayBillNumber: inv.ewayBillNumber.value,
    currency: inv.currency.value,
    placeOfSupply: inv.placeOfSupply.value,
    issuerName: inv.issuer.name.value,
    issuerGstin: inv.issuer.gstin.value,
    partyName: party.name.value,
    partyGstin: party.gstin.value,
    partyPhone: party.phone.value,
    partyAddress: party.addressLines.join(", ") || null,
    lines: inv.lines.map((l) => ({
      lineNo: l.lineNo,
      kind: l.kind,
      description: l.description.value,
      hsn: l.hsn.value,
      sku: l.sku.value,
      barcode: l.barcode.value,
      brand: l.brand.value,
      quantity: l.quantity.value,
      unit: l.unit.value,
      rate: l.rate.value,
      discountPercent: l.discountPercent.value,
      gstRate: l.gstRate.value,
      amount: l.amount.value,
      rawText: l.rawText,
    })),
    totals: {
      grossAmount: t.grossAmount.value,
      discountPercent: t.discountPercent.value,
      discountAmount: t.discountAmount.value,
      taxableAmount: t.taxableAmount.value,
      cgst: t.cgst.value,
      sgst: t.sgst.value,
      igst: t.igst.value,
      cess: t.cess.value,
      freight: t.freight.value,
      packing: t.packing.value,
      otherCharges: t.otherCharges.value,
      roundOff: t.roundOff.value,
      grandTotal: t.grandTotal.value,
    },
    amountInWords: t.amountInWords.value,
    amountInWordsValue: t.amountInWordsValue,
    taxRateSummary: t.taxRateSummary,
  };
}
