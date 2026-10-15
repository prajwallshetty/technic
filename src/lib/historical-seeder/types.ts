/**
 * Types for the Historical Invoice CSV Seeder
 */

export interface RawCustomerRow {
  customer_name: string;
  gstin: string;
  source_pdf: string;
  review_required: string;
}

export interface RawInvoiceRow {
  source_pdf: string;
  invoice_number: string;
  invoice_date: string;
  customer_name_candidate: string;
  customer_gstin_candidate: string;
  supplier_gstin_candidate: string;
  taxable_value_candidate: string;
  gross_amount_candidate: string;
  discount_amount_candidate: string;
  cgst_candidate: string;
  sgst_candidate: string;
  igst_candidate: string;
  tax_type_candidate: string;
  invoice_total_candidate: string;
  line_item_count: string;
  review_required: string;
  review_notes: string;
}

export interface RawInvoiceItemRow {
  source_pdf: string;
  invoice_number: string;
  line_no: string;
  hsn: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  gst_percent: string;
  line_amount: string;
  review_required: string;
}

export interface CustomerResolution {
  status: "MATCHED" | "CREATED" | "FAILED";
  customerId?: string;
  customerCode?: string;
  customerName: string;
  phone?: string;
  gstin?: string;
  error?: string;
}

export interface ProductResolution {
  status: "MATCHED" | "UNRESOLVED";
  productId?: string;
  sku?: string;
  productName?: string;
  hsnCode?: string;
  confidence: "HIGH" | "NONE";
  method?: "SKU_EXACT" | "BARCODE_EXACT" | "MAPPING_TABLE" | "HSN_SINGLETON";
  reason?: string;
}

export interface ValidatedLineItem {
  lineNo: number;
  hsn: string | null;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  gstPercent: number;
  lineAmount: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  productId?: string;
  productResolution: ProductResolution;
}

export interface ValidationIssue {
  type:
    | "REVIEW_FLAGGED"
    | "MISSING_INVOICE_NUMBER"
    | "MISSING_INVOICE_DATE"
    | "INVALID_DATE_FORMAT"
    | "CUSTOMER_UNRESOLVED"
    | "PRODUCT_UNRESOLVED"
    | "NO_LINE_ITEMS"
    | "TOTAL_DISCREPANCY"
    | "TAX_DISCREPANCY"
    | "DUPLICATE_INVOICE_NUMBER"
    | "INVALID_AMOUNTS";
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidatedInvoice {
  sourcePdf: string;
  invoiceNumber: string;
  invoiceDate: Date;
  customerNameCandidate: string;
  customerGstinCandidate: string | null;
  customerResolution: CustomerResolution;
  isGst: boolean;
  taxMode: "GST" | "NON_GST";
  financialYear: string;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  totalAmount: number;
  lines: ValidatedLineItem[];
  reviewRequired: boolean;
  reviewNotes: string[];
  issues: ValidationIssue[];
  isValidForImport: boolean;
}

export interface SeederOptions {
  dataDir: string;
  dryRun: boolean;
  confirm: boolean;
  firmId: string;
  branchId: string;
  sampleTest?: boolean;
  reportOut?: string;
  resolveInvoiceNumbers?: boolean;
  autoCatalogProducts?: boolean;
  fallbackEmptyItems?: boolean;
  forceReview?: boolean;
}

export interface ImportSummary {
  startedAt: Date;
  completedAt: Date;
  mode: "DRY_RUN" | "IMPORT";
  sourceFiles: {
    invoicesPath: string;
    itemsPath: string;
    customersPath: string;
    reviewRequiredPath: string;
  };
  totalCustomersProcessed: number;
  customersMatched: number;
  customersCreated: number;
  customersFailed: number;
  totalInvoicesInCsv: number;
  invoicesFlaggedForReview: number;
  invoicesMissingNumber: number;
  invoicesWithDiscrepancies: number;
  invoicesValidForImport: number;
  invoicesActuallyImported: number;
  invoicesSkippedAsDuplicate: number;
  invoicesRejected: number;
  totalLineItemsProcessed: number;
  lineItemsMatchedToProduct: number;
  lineItemsUnresolvedProduct: number;
  lineItemsImported: number;
  sampleTestResult?: {
    success: boolean;
    sampleInvoiceNumber: string;
    invoiceId: string;
    pdfGenerated: boolean;
    pdfSizeBytes: number;
    error?: string;
  };
  invoices: ValidatedInvoice[];
}
