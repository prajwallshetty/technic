import { financialYearFor } from "@/lib/sequence";
import type {
  RawInvoiceRow,
  RawInvoiceItemRow,
  ValidatedInvoice,
  ValidatedLineItem,
  ValidationIssue,
  CustomerResolution,
  SeederOptions,
} from "./types";
import { CustomerMatcher } from "./customer-matcher";
import { ProductMatcher } from "./product-matcher";

const round2 = (val: number) => Math.round((val + Number.EPSILON) * 100) / 100;

export class InvoiceValidator {
  private customerMatcher: CustomerMatcher;
  private productMatcher: ProductMatcher;
  private existingInvoiceNumbers: Set<string>;

  constructor(
    customerMatcher: CustomerMatcher,
    productMatcher: ProductMatcher,
    existingInvoiceNumbers: Set<string>,
  ) {
    this.customerMatcher = customerMatcher;
    this.productMatcher = productMatcher;
    this.existingInvoiceNumbers = existingInvoiceNumbers;
  }

  /**
   * Validates a raw invoice row and its line items.
   */
  async validateInvoice(
    rawInvoice: RawInvoiceRow,
    rawItems: RawInvoiceItemRow[],
    dryRun = false,
    options?: SeederOptions,
  ): Promise<ValidatedInvoice> {
    const issues: ValidationIssue[] = [];
    const reviewNotes: string[] = [];

    if (rawInvoice.review_notes) {
      reviewNotes.push(rawInvoice.review_notes);
    }

    // 1. Check review_required flag from CSV
    const reviewRequired =
      rawInvoice.review_required?.trim().toLowerCase() === "yes" ||
      rawItems.some((it) => it.review_required?.trim().toLowerCase() === "yes");

    if (reviewRequired) {
      issues.push({
        type: "REVIEW_FLAGGED",
        message: "Invoice is flagged for manual review in source CSV.",
      });
    }

    // 2. Validate Invoice Number
    let invoiceNumber = rawInvoice.invoice_number?.trim();
    if (!invoiceNumber && options?.resolveInvoiceNumbers) {
      // Extract sequential invoice number from filename (e.g., "136.pdf" -> "136")
      const match = rawInvoice.source_pdf.match(/^(\d+)/);
      if (match) {
        invoiceNumber = match[1];
      }
    }

    if (!invoiceNumber) {
      issues.push({
        type: "MISSING_INVOICE_NUMBER",
        message: "Invoice number is missing or was not extracted.",
      });
    } else if (this.existingInvoiceNumbers.has(invoiceNumber)) {
      issues.push({
        type: "DUPLICATE_INVOICE_NUMBER",
        message: `Invoice number '${invoiceNumber}' already exists in the database.`,
        details: { invoiceNumber },
      });
    }

    // 3. Validate Invoice Date
    let invoiceDate: Date;
    const rawDate = rawInvoice.invoice_date?.trim();
    if (!rawDate) {
      issues.push({
        type: "MISSING_INVOICE_DATE",
        message: "Invoice date is missing.",
      });
      invoiceDate = new Date();
    } else {
      invoiceDate = new Date(rawDate);
      if (isNaN(invoiceDate.getTime())) {
        issues.push({
          type: "INVALID_DATE_FORMAT",
          message: `Invalid date format: '${rawDate}'`,
          details: { rawDate },
        });
        invoiceDate = new Date();
      }
    }

    const financialYear = financialYearFor(invoiceDate);

    // 4. Validate Customer Resolution
    const customerResolution: CustomerResolution = await this.customerMatcher.resolveCustomer(
      rawInvoice.customer_name_candidate,
      rawInvoice.customer_gstin_candidate,
      dryRun,
    );

    if (customerResolution.status === "FAILED") {
      issues.push({
        type: "CUSTOMER_UNRESOLVED",
        message: customerResolution.error || "Customer could not be resolved or created.",
        details: {
          candidateName: rawInvoice.customer_name_candidate,
          candidateGstin: rawInvoice.customer_gstin_candidate,
        },
      });
    }

    // Determine tax type
    const isInterState = rawInvoice.tax_type_candidate?.trim().toUpperCase() === "IGST";
    const isGst =
      rawInvoice.tax_type_candidate?.trim().toUpperCase().includes("GST") ||
      Boolean(rawInvoice.cgst_candidate || rawInvoice.sgst_candidate || rawInvoice.igst_candidate);

    // 5. Line items handling & fallback
    let itemsToProcess = [...rawItems];
    if (itemsToProcess.length === 0 && options?.fallbackEmptyItems) {
      const candidateGross = Number(rawInvoice.gross_amount_candidate) || Number(rawInvoice.invoice_total_candidate) || 1000;
      const candidateTaxable = Number(rawInvoice.taxable_value_candidate) || candidateGross;
      itemsToProcess = [
        {
          source_pdf: rawInvoice.source_pdf,
          invoice_number: invoiceNumber || "",
          line_no: "1",
          hsn: "85071000",
          description: "Batteries / Goods as per Original Bill",
          quantity: "1",
          unit: "pcs",
          rate: String(candidateTaxable),
          gst_percent: isGst ? "18" : "0",
          line_amount: String(candidateTaxable),
          review_required: "No",
        },
      ];
    }

    if (itemsToProcess.length === 0) {
      issues.push({
        type: "NO_LINE_ITEMS",
        message: "Invoice contains no line items.",
      });
    }

    const validatedLines: ValidatedLineItem[] = [];
    let linesTaxableSum = 0;
    let linesCgstSum = 0;
    let linesSgstSum = 0;
    let linesIgstSum = 0;
    let linesAmountSum = 0;

    for (let idx = 0; idx < itemsToProcess.length; idx++) {
      const it = itemsToProcess[idx];
      const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
      const rate = round2(Number(it.rate) || 0);
      const lineAmount = round2(Number(it.line_amount) || qty * rate);
      const gstPercent = Number(it.gst_percent) || (isGst ? 18 : 0);

      // Product resolution (supports autoCatalogProducts if enabled)
      const prodRes = await this.productMatcher.resolveOrCreateProduct(
        it.description,
        it.hsn,
        gstPercent,
        rate,
        Boolean(options?.autoCatalogProducts),
        dryRun,
      );

      if (prodRes.status === "UNRESOLVED") {
        issues.push({
          type: "PRODUCT_UNRESOLVED",
          message: prodRes.reason || `Unresolved product: '${it.description}'`,
          details: { itemIndex: idx + 1, description: it.description, hsn: it.hsn },
        });
      }

      // Compute line taxes
      const taxableValue = lineAmount;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;
      if (isGst && gstPercent > 0) {
        if (isInterState) {
          igst = round2((taxableValue * gstPercent) / 100);
        } else {
          cgst = round2((taxableValue * gstPercent) / 200);
          sgst = round2((taxableValue * gstPercent) / 200);
        }
      }

      linesTaxableSum += taxableValue;
      linesCgstSum += cgst;
      linesSgstSum += sgst;
      linesIgstSum += igst;
      linesAmountSum += lineAmount;

      validatedLines.push({
        lineNo: idx + 1,
        hsn: it.hsn?.trim() || null,
        description: it.description?.trim() || "Item",
        quantity: qty,
        unit: it.unit?.trim().toLowerCase() || "pcs",
        rate,
        gstPercent,
        lineAmount,
        taxableValue,
        cgstAmount: cgst,
        sgstAmount: sgst,
        igstAmount: igst,
        productId: prodRes.productId,
        productResolution: prodRes,
      });
    }

    // 6. Mathematical validation & Totals
    const headerGross = Number(rawInvoice.gross_amount_candidate) || linesAmountSum;
    const headerDiscount = Number(rawInvoice.discount_amount_candidate) || 0;
    const headerTaxable = Number(rawInvoice.taxable_value_candidate) || linesTaxableSum;
    const headerCgst = Number(rawInvoice.cgst_candidate) || linesCgstSum;
    const headerSgst = Number(rawInvoice.sgst_candidate) || linesSgstSum;
    const headerIgst = Number(rawInvoice.igst_candidate) || linesIgstSum;
    const headerTotal = Number(rawInvoice.invoice_total_candidate) || 0;

    const subtotal = round2(headerGross || linesAmountSum);
    const discountAmount = round2(headerDiscount);
    const taxableAmount = round2(headerTaxable || subtotal - discountAmount);
    const cgstAmount = round2(headerCgst);
    const sgstAmount = round2(headerSgst);
    const igstAmount = round2(headerIgst);

    const calculatedTotalPreRound = round2(taxableAmount + cgstAmount + sgstAmount + igstAmount);
    const totalAmount = headerTotal > 0 ? round2(headerTotal) : Math.round(calculatedTotalPreRound);
    const roundOff = round2(totalAmount - calculatedTotalPreRound);

    // Check discrepancy if header total was provided
    if (headerTotal > 0 && Math.abs(headerTotal - calculatedTotalPreRound) > 2.0) {
      issues.push({
        type: "TOTAL_DISCREPANCY",
        message: `Header total (₹${headerTotal}) differs from calculated total (₹${calculatedTotalPreRound}) by > ₹2.00.`,
        details: {
          headerTotal,
          calculatedTotalPreRound,
          diff: round2(headerTotal - calculatedTotalPreRound),
        },
      });
    }

    // Determine if safe for import
    const blockingTypes = new Set<ValidationIssue["type"]>([
      "MISSING_INVOICE_NUMBER",
      "CUSTOMER_UNRESOLVED",
      "PRODUCT_UNRESOLVED",
      "NO_LINE_ITEMS",
      "DUPLICATE_INVOICE_NUMBER",
    ]);

    if (!options?.forceReview) {
      blockingTypes.add("REVIEW_FLAGGED");
    }

    const hasBlockingIssues = issues.some((iss) => blockingTypes.has(iss.type));
    const isValidForImport = !hasBlockingIssues && Boolean(invoiceNumber);

    return {
      sourcePdf: rawInvoice.source_pdf,
      invoiceNumber: invoiceNumber || "",
      invoiceDate,
      customerNameCandidate: rawInvoice.customer_name_candidate,
      customerGstinCandidate: rawInvoice.customer_gstin_candidate || null,
      customerResolution,
      isGst,
      taxMode: isGst ? "GST" : "NON_GST",
      financialYear,
      subtotal,
      discountAmount,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      roundOff,
      totalAmount,
      lines: validatedLines,
      reviewRequired,
      reviewNotes,
      issues,
      isValidForImport,
    };
  }
}
