import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateInvoicePDF } from "@/lib/pdf/pdf-templates";
import { DOCUMENT_TYPES, financialYearFor, syncDocumentSequenceFloor } from "@/lib/sequence";
import { parseCsvFile } from "./csv-parser";
import { CustomerMatcher } from "./customer-matcher";
import { ProductMatcher } from "./product-matcher";
import { InvoiceValidator } from "./invoice-validator";
import { saveReports } from "./report-generator";
import type {
  RawCustomerRow,
  RawInvoiceRow,
  RawInvoiceItemRow,
  SeederOptions,
  ImportSummary,
  ValidatedInvoice,
} from "./types";

async function withRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 1000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (i < attempts - 1) {
        console.warn(`Database connection retry (${i + 1}/${attempts}): ${err?.message || err}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

export class HistoricalImporter {
  private options: SeederOptions;

  constructor(options: SeederOptions) {
    this.options = options;
  }

  /**
   * Resolves the active data directory containing the CSV files.
   */
  private resolveCsvPaths() {
    let baseDir = this.options.dataDir;
    if (!fs.existsSync(baseDir)) {
      // Fallback check in public
      const publicDir = path.join(process.cwd(), "public");
      if (fs.existsSync(path.join(publicDir, "invoices.csv"))) {
        baseDir = publicDir;
      } else {
        throw new Error(`Data directory not found: ${baseDir}`);
      }
    }

    const invoicesPath = path.join(baseDir, "invoices.csv");
    const itemsPath = path.join(baseDir, "invoice_items.csv");
    const customersPath = path.join(baseDir, "customers.csv");
    const reviewRequiredPath = path.join(baseDir, "review_required.csv");

    if (!fs.existsSync(invoicesPath)) throw new Error(`Missing ${invoicesPath}`);
    if (!fs.existsSync(itemsPath)) throw new Error(`Missing ${itemsPath}`);
    if (!fs.existsSync(customersPath)) throw new Error(`Missing ${customersPath}`);

    return { invoicesPath, itemsPath, customersPath, reviewRequiredPath };
  }

  /**
   * Runs the historical data import or dry-run.
   */
  async execute(): Promise<ImportSummary> {
    const startedAt = new Date();
    const paths = this.resolveCsvPaths();

    console.log(`\n======================================================`);
    console.log(`TECHNIC TECHNOLOGY ERP — HISTORICAL INVOICE SEEDER`);
    console.log(`Mode: ${this.options.dryRun ? "DRY RUN (No DB writes)" : "PRODUCTION IMPORT"}`);
    console.log(`Data Directory: ${this.options.dataDir}`);
    console.log(`Firm ID: ${this.options.firmId}`);
    console.log(`Branch ID: ${this.options.branchId}`);
    console.log(`======================================================\n`);

    // 1. Parse CSV files
    console.log(`Reading CSV files...`);
    const rawCustomers = parseCsvFile<RawCustomerRow>(paths.customersPath);
    const rawInvoices = parseCsvFile<RawInvoiceRow>(paths.invoicesPath);
    const rawItems = parseCsvFile<RawInvoiceItemRow>(paths.itemsPath);

    console.log(`  • Customers in CSV: ${rawCustomers.length}`);
    console.log(`  • Invoices in CSV: ${rawInvoices.length}`);
    console.log(`  • Line items in CSV: ${rawItems.length}`);

    // 2. Initialize Matchers & Pre-load Caches
    console.log(`\nInitializing matchers and pre-loading existing records...`);

    // Auto-resolve active branch in this database if branchId is empty or not in current DB
    const branchInDb = await withRetry(() =>
      prisma.branch.findFirst({
        where: { firmId: this.options.firmId, isActive: true },
        select: { id: true, name: true, code: true },
      })
    );
    if (branchInDb) {
      const explicitBranchExists = this.options.branchId
        ? await withRetry(() =>
            prisma.branch.findFirst({
              where: { id: this.options.branchId, firmId: this.options.firmId },
            })
          )
        : null;
      if (!explicitBranchExists) {
        this.options.branchId = branchInDb.id;
        console.log(`  • Resolved active branch: ${branchInDb.name} (${branchInDb.id})`);
      }
    }

    const customerMatcher = new CustomerMatcher(this.options.firmId, this.options.branchId);
    await customerMatcher.init();

    const productMatcher = new ProductMatcher(this.options.firmId);
    await productMatcher.init(this.options.dataDir);

    // Load existing invoice numbers in firm
    const existingInvoices = await withRetry(() =>
      prisma.invoice.findMany({
        where: { firmId: this.options.firmId },
        select: { invoiceNumber: true },
      })
    );
    const existingInvoiceNumbers = new Set(existingInvoices.map((i) => i.invoiceNumber));
    console.log(`  • Existing invoices in database: ${existingInvoiceNumbers.size}`);

    // 3. Process Customers from customers.csv
    console.log(`\nProcessing customers from customers.csv...`);
    const customerResults = await customerMatcher.processCustomerList(rawCustomers, this.options.dryRun);
    const customersMatched = customerResults.filter((r) => r.status === "MATCHED").length;
    const customersCreated = customerResults.filter((r) => r.status === "CREATED").length;
    const customersFailed = customerResults.filter((r) => r.status === "FAILED").length;
    console.log(`  • Matched: ${customersMatched}, Created: ${customersCreated}, Failed/Unresolved: ${customersFailed}`);

    // 4. Index Items by source_pdf
    const itemsByPdf = new Map<string, RawInvoiceItemRow[]>();
    for (const item of rawItems) {
      const pdf = item.source_pdf.trim();
      const list = itemsByPdf.get(pdf) || [];
      list.push(item);
      itemsByPdf.set(pdf, list);
    }

    // 5. Validate All Invoices
    console.log(`\nValidating historical invoices and line items...`);
    const validator = new InvoiceValidator(customerMatcher, productMatcher, existingInvoiceNumbers);
    const validatedInvoices: ValidatedInvoice[] = [];

    for (const rawInv of rawInvoices) {
      const items = itemsByPdf.get(rawInv.source_pdf.trim()) || [];
      const val = await validator.validateInvoice(rawInv, items, this.options.dryRun, this.options);
      validatedInvoices.push(val);
    }

    // 6. Calculate statistics
    const invoicesFlaggedForReview = validatedInvoices.filter((i) => i.reviewRequired).length;
    const invoicesMissingNumber = validatedInvoices.filter((i) => !i.invoiceNumber).length;
    const invoicesWithDiscrepancies = validatedInvoices.filter((i) =>
      i.issues.some((iss) => iss.type === "TOTAL_DISCREPANCY"),
    ).length;
    const invoicesValidForImport = validatedInvoices.filter((i) => i.isValidForImport).length;

    let lineItemsMatched = 0;
    let lineItemsUnresolved = 0;
    for (const inv of validatedInvoices) {
      for (const l of inv.lines) {
        if (l.productResolution.status === "MATCHED") lineItemsMatched++;
        else lineItemsUnresolved++;
      }
    }

    // 7. Perform Database Insertion (if in IMPORT mode)
    let invoicesActuallyImported = 0;
    let invoicesSkippedAsDuplicate = 0;
    let lineItemsImported = 0;

    if (!this.options.dryRun) {
      if (!this.options.confirm) {
        throw new Error(
          "Refusing to execute database writes without explicit confirmation flag (--confirm). Run with --dry-run first to preview.",
        );
      }

      console.log(`\nImporting validated records into production database...`);
      for (const inv of validatedInvoices) {
        if (!inv.isValidForImport) continue;

        if (existingInvoiceNumbers.has(inv.invoiceNumber)) {
          invoicesSkippedAsDuplicate++;
          continue;
        }

        // Bounded database write per invoice with retry
        await withRetry(async () => {
          await prisma.invoice.create({
            data: {
              firmId: this.options.firmId,
              branchId: this.options.branchId,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate,
              kind: inv.isGst ? "TAX_INVOICE" : "NON_GST_BILL",
              taxMode: inv.taxMode,
              financialYear: inv.financialYear,
              status: "ISSUED",
              customerId: inv.customerResolution.customerId!,
              billToName: inv.customerResolution.customerName,
              billToPhone: inv.customerResolution.phone ?? null,
              billToGstin: inv.customerResolution.gstin ?? null,
              subtotal: inv.subtotal,
              discountAmount: inv.discountAmount,
              taxableAmount: inv.taxableAmount,
              cgstAmount: inv.cgstAmount,
              sgstAmount: inv.sgstAmount,
              igstAmount: inv.igstAmount,
              roundOff: inv.roundOff,
              totalAmount: inv.totalAmount,
              amountPaid: 0,
              amountDue: inv.totalAmount,
              notes: `Historical invoice imported from ${inv.sourcePdf}`,
              lines: {
                create: inv.lines.map((l) => ({
                  productId: l.productId!,
                  description: l.description,
                  hsnCode: l.hsn,
                  quantity: l.quantity,
                  unitPrice: l.rate,
                  taxableValue: l.taxableValue,
                  cgstAmount: l.cgstAmount,
                  sgstAmount: l.sgstAmount,
                  igstAmount: l.igstAmount,
                  lineTotal: l.lineAmount,
                })),
              },
            },
          });

          existingInvoiceNumbers.add(inv.invoiceNumber);
          invoicesActuallyImported++;
          lineItemsImported += inv.lines.length;
        });

        if (invoicesActuallyImported % 10 === 0) {
          console.log(`  • Imported ${invoicesActuallyImported} invoices...`);
        }
      }
      console.log(`  • Import complete: ${invoicesActuallyImported} invoices, ${lineItemsImported} line items inserted.`);

      // Synchronize document sequences with highest historical invoice number
      let maxHistoricalNumber = 0;
      for (const inv of validatedInvoices) {
        if (inv.invoiceNumber) {
          const match = inv.invoiceNumber.match(/(\d+)(?!.*\d)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxHistoricalNumber) {
              maxHistoricalNumber = num;
            }
          }
        }
      }

      if (maxHistoricalNumber > 0) {
        const fy = financialYearFor(new Date());
        await withRetry(async () => {
          await syncDocumentSequenceFloor(this.options.firmId, DOCUMENT_TYPES.INVOICE, "GST", fy, maxHistoricalNumber);
          await syncDocumentSequenceFloor(this.options.firmId, DOCUMENT_TYPES.INVOICE, "NON_GST", fy, maxHistoricalNumber);
        });
        console.log(`  • Synchronized invoice sequence: next invoice will continue from ${maxHistoricalNumber + 1}`);
      }
    }

    // 8. Run sample verification test if requested
    let sampleTestResult: ImportSummary["sampleTestResult"] | undefined;
    if (this.options.sampleTest) {
      console.log(`\nRunning controlled sample verification test...`);
      sampleTestResult = await this.runSampleVerificationTest();
    }

    const completedAt = new Date();

    const summary: ImportSummary = {
      startedAt,
      completedAt,
      mode: this.options.dryRun ? "DRY_RUN" : "IMPORT",
      sourceFiles: paths,
      totalCustomersProcessed: rawCustomers.length,
      customersMatched,
      customersCreated,
      customersFailed,
      totalInvoicesInCsv: rawInvoices.length,
      invoicesFlaggedForReview,
      invoicesMissingNumber,
      invoicesWithDiscrepancies,
      invoicesValidForImport,
      invoicesActuallyImported,
      invoicesSkippedAsDuplicate,
      invoicesRejected: rawInvoices.length - invoicesActuallyImported,
      totalLineItemsProcessed: rawItems.length,
      lineItemsMatchedToProduct: lineItemsMatched,
      lineItemsUnresolvedProduct: lineItemsUnresolved,
      lineItemsImported,
      sampleTestResult,
      invoices: validatedInvoices,
    };

    // 9. Save detailed reports
    const { markdownPath, jsonPath } = saveReports(summary, this.options.reportOut);
    console.log(`\n======================================================`);
    console.log(`REPORTS GENERATED:`);
    console.log(`  • Markdown: ${markdownPath}`);
    console.log(`  • JSON:     ${jsonPath}`);
    console.log(`======================================================\n`);

    return summary;
  }

  /**
   * Sample verification test per Section 10:
   * - Imports a validated sample historical invoice
   * - Verifies the database records
   * - Renders and validates the PDF without crashing
   */
  async runSampleVerificationTest(): Promise<NonNullable<ImportSummary["sampleTestResult"]>> {
    const sampleInvoiceNumber = `HIST/SAMPLE/${Date.now().toString().slice(-6)}`;
    try {
      // Find an existing active product
      const product = await prisma.product.findFirst({
        where: { firmId: this.options.firmId, status: "ACTIVE" },
      });
      if (!product) throw new Error("No active product found in firm for sample test");

      // Find or create sample customer
      let customer = await prisma.customer.findFirst({
        where: { firmId: this.options.firmId },
      });
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            code: "CUST-SAMPLE-01",
            firmId: this.options.firmId,
            branchId: this.options.branchId,
            name: "Sample Historical Customer",
            phone: "9876543210",
          },
        });
      }

      const invoiceDate = new Date("2026-04-15");
      const unitPrice = Number(product.sellingPrice) || 1000;
      const quantity = 2;
      const lineTotal = unitPrice * quantity;
      const gstRate = Number(product.gstRate) || 18;
      const taxableValue = lineTotal;
      const cgst = (taxableValue * gstRate) / 200;
      const sgst = (taxableValue * gstRate) / 200;
      const totalAmount = taxableValue + cgst + sgst;

      // Create sample historical invoice inside transaction
      const invoice = await prisma.$transaction(async (tx) => {
        return tx.invoice.create({
          data: {
            firmId: this.options.firmId,
            branchId: this.options.branchId,
            invoiceNumber: sampleInvoiceNumber,
            invoiceDate,
            kind: "TAX_INVOICE",
            taxMode: "GST",
            financialYear: "26-27",
            status: "ISSUED",
            customerId: customer.id,
            billToName: customer.name,
            billToPhone: customer.phone,
            subtotal: lineTotal,
            discountAmount: 0,
            taxableAmount: taxableValue,
            cgstAmount: cgst,
            sgstAmount: sgst,
            igstAmount: 0,
            roundOff: 0,
            totalAmount,
            amountPaid: 0,
            amountDue: totalAmount,
            notes: "Sample historical test invoice for verification",
            lines: {
              create: [
                {
                  productId: product.id,
                  description: `${product.name} (Historical Sample)`,
                  hsnCode: product.hsnCode || "85044010",
                  quantity,
                  unitPrice,
                  taxableValue,
                  cgstAmount: cgst,
                  sgstAmount: sgst,
                  igstAmount: 0,
                  lineTotal,
                },
              ],
            },
          },
          include: { lines: true },
        });
      });

      // Verify database record
      const dbVerify = await prisma.invoice.findUnique({
        where: { id: invoice.id },
        include: { lines: true, customer: true },
      });
      if (!dbVerify || dbVerify.lines.length !== 1) {
        throw new Error("Sample invoice database verification failed");
      }

      // Generate invoice PDF
      const pdf = await generateInvoicePDF(invoice.id);
      if (!pdf.buffer || pdf.buffer.length === 0) {
        throw new Error("Sample invoice PDF buffer was empty");
      }

      console.log(`  ✅ Sample invoice created: ${invoice.invoiceNumber} (ID: ${invoice.id})`);
      console.log(`  ✅ Database record verified: 1 line item, Total ₹${dbVerify.totalAmount}`);
      console.log(`  ✅ PDF generated successfully: ${pdf.fileName} (${pdf.buffer.length} bytes)`);

      return {
        success: true,
        sampleInvoiceNumber: invoice.invoiceNumber,
        invoiceId: invoice.id,
        pdfGenerated: true,
        pdfSizeBytes: pdf.buffer.length,
      };
    } catch (err) {
      console.error(`  ❌ Sample verification failed:`, err);
      return {
        success: false,
        sampleInvoiceNumber,
        invoiceId: "",
        pdfGenerated: false,
        pdfSizeBytes: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
