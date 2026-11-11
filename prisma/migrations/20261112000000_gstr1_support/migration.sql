-- GSTR-1 support: credit/debit notes, advance receipts and GST classification
-- fields (supply type, place of supply code, reverse charge, export details, UQC,
-- taxability, cess). Additive only: no existing column or row is changed.
-- Idempotent: the local PGlite setup re-applies every migration on start-up.

DO $$ BEGIN
  CREATE TYPE "GstTreatment" AS ENUM ('REGISTERED', 'UNREGISTERED', 'SEZ', 'DEEMED_EXPORT', 'OVERSEAS', 'UIN_HOLDER', 'COMPOSITION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceSupplyType" AS ENUM ('REGULAR', 'SEZ_WITH_PAYMENT', 'SEZ_WITHOUT_PAYMENT', 'DEEMED_EXPORT', 'EXPORT_WITH_PAYMENT', 'EXPORT_WITHOUT_PAYMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SupplyTaxability" AS ENUM ('TAXABLE', 'NIL_RATED', 'EXEMPTED', 'NON_GST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NoteType" AS ENUM ('CREDIT', 'DEBIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NoteStatus" AS ENUM ('ISSUED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NoteReason" AS ENUM ('SALES_RETURN', 'POST_SALE_DISCOUNT', 'DEFICIENCY_IN_SERVICES', 'CORRECTION_IN_INVOICE', 'CHANGE_IN_POS', 'FINALIZATION_OF_PROVISIONAL_ASSESSMENT', 'OTHERS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdvanceStatus" AS ENUM ('RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'NOTE_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADVANCE_RECEIPT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_GST_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GSTR1_EXPORTED';

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "gstTreatment" "GstTreatment";
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "cessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "taxability" "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE';
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "uqc" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "cessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "ecommerceGstin" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "placeOfSupplyCode" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "portCode" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reverseCharge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "shippingBillDate" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "shippingBillNumber" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "supplyType" "InvoiceSupplyType" NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isService" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "taxability" "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "uqc" TEXT;

CREATE TABLE IF NOT EXISTS "credit_debit_notes" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "noteType" "NoteType" NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "noteDate" TIMESTAMP(3) NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'ISSUED',
    "customerId" TEXT NOT NULL,
    "billToName" TEXT NOT NULL,
    "billToGstin" TEXT,
    "originalInvoiceId" TEXT,
    "originalInvoiceNumber" TEXT,
    "originalInvoiceDate" TIMESTAMP(3),
    "reason" "NoteReason" NOT NULL,
    "reasonText" TEXT,
    "salesReturnId" TEXT,
    "placeOfSupply" TEXT,
    "placeOfSupplyCode" TEXT,
    "supplyType" "InvoiceSupplyType" NOT NULL DEFAULT 'REGULAR',
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "credit_debit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "credit_debit_note_lines" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "productId" TEXT,
    "invoiceLineId" TEXT,
    "description" TEXT NOT NULL,
    "hsnCode" TEXT,
    "uqc" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxability" "SupplyTaxability" NOT NULL DEFAULT 'TAXABLE',
    "taxableValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "credit_debit_note_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "advance_receipts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'RECEIVED',
    "placeOfSupply" TEXT,
    "placeOfSupplyCode" TEXT,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "advance_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "advance_adjustments" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "adjustedAmount" DECIMAL(12,2) NOT NULL,
    "adjustedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advance_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_debit_notes_salesReturnId_key" ON "credit_debit_notes"("salesReturnId");
CREATE INDEX IF NOT EXISTS "credit_debit_notes_firmId_noteDate_idx" ON "credit_debit_notes"("firmId", "noteDate");
CREATE INDEX IF NOT EXISTS "credit_debit_notes_customerId_idx" ON "credit_debit_notes"("customerId");
CREATE INDEX IF NOT EXISTS "credit_debit_notes_originalInvoiceId_idx" ON "credit_debit_notes"("originalInvoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "credit_debit_notes_firmId_noteType_noteNumber_key" ON "credit_debit_notes"("firmId", "noteType", "noteNumber");
CREATE INDEX IF NOT EXISTS "credit_debit_note_lines_noteId_idx" ON "credit_debit_note_lines"("noteId");
CREATE INDEX IF NOT EXISTS "advance_receipts_firmId_receiptDate_idx" ON "advance_receipts"("firmId", "receiptDate");
CREATE UNIQUE INDEX IF NOT EXISTS "advance_receipts_firmId_receiptNumber_key" ON "advance_receipts"("firmId", "receiptNumber");
CREATE INDEX IF NOT EXISTS "advance_adjustments_advanceId_idx" ON "advance_adjustments"("advanceId");
CREATE INDEX IF NOT EXISTS "advance_adjustments_invoiceId_idx" ON "advance_adjustments"("invoiceId");

DO $$ BEGIN
  ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_debit_note_lines" ADD CONSTRAINT "credit_debit_note_lines_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "credit_debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_debit_note_lines" ADD CONSTRAINT "credit_debit_note_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_debit_note_lines" ADD CONSTRAINT "credit_debit_note_lines_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "invoice_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "advance_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

