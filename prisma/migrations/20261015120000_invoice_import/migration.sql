-- Bulk invoice import staging tables. Idempotent: the local PGlite setup
-- re-applies every migration on start-up.

DO $$ BEGIN
  CREATE TYPE "InvoiceImportBatchStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'READY', 'FAILED', 'DUPLICATE', 'APPROVED', 'POSTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceImportDirection" AS ENUM ('SALES', 'PURCHASE', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_IMPORT_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_IMPORT_PROCESSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_IMPORT_EDITED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_IMPORT_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_IMPORT_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_IMPORT_POSTED';

CREATE TABLE IF NOT EXISTS "invoice_import_batches" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "status" "InvoiceImportBatchStatus" NOT NULL DEFAULT 'QUEUED',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "skippedFiles" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "invoice_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invoice_import_documents" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "status" "InvoiceImportStatus" NOT NULL DEFAULT 'QUEUED',
    "direction" "InvoiceImportDirection" NOT NULL DEFAULT 'UNKNOWN',
    "extractionMethod" TEXT,
    "layoutId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "rawText" TEXT,
    "extraction" JSONB,
    "draft" JSONB,
    "evaluation" JSONB,
    "assignments" JSONB,
    "acknowledgements" JSONB,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "partyName" TEXT,
    "partyGstin" TEXT,
    "grandTotal" DECIMAL(14,2),
    "calculatedTotal" DECIMAL(14,2),
    "confidence" DECIMAL(4,3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateOfId" TEXT,
    "duplicateReason" TEXT,
    "importKey" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "postedEntity" TEXT,
    "postedEntityId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_import_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invoice_import_files" (
    "documentId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "invoice_import_files_pkey" PRIMARY KEY ("documentId")
);

CREATE TABLE IF NOT EXISTS "invoice_import_product_aliases" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "partyKey" TEXT NOT NULL DEFAULT '',
    "aliasKey" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_import_product_aliases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_import_batches_firmId_createdAt_idx" ON "invoice_import_batches"("firmId", "createdAt");
CREATE INDEX IF NOT EXISTS "invoice_import_documents_firmId_status_idx" ON "invoice_import_documents"("firmId", "status");
CREATE INDEX IF NOT EXISTS "invoice_import_documents_batchId_idx" ON "invoice_import_documents"("batchId");
CREATE INDEX IF NOT EXISTS "invoice_import_documents_firmId_sha256_idx" ON "invoice_import_documents"("firmId", "sha256");
CREATE INDEX IF NOT EXISTS "invoice_import_documents_firmId_invoiceNumber_idx" ON "invoice_import_documents"("firmId", "invoiceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_import_documents_firmId_importKey_key" ON "invoice_import_documents"("firmId", "importKey");
CREATE INDEX IF NOT EXISTS "invoice_import_product_aliases_productId_idx" ON "invoice_import_product_aliases"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_import_product_aliases_firmId_partyKey_aliasKey_key" ON "invoice_import_product_aliases"("firmId", "partyKey", "aliasKey");

DO $$ BEGIN
  ALTER TABLE "invoice_import_batches" ADD CONSTRAINT "invoice_import_batches_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_import_documents" ADD CONSTRAINT "invoice_import_documents_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_import_documents" ADD CONSTRAINT "invoice_import_documents_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "invoice_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_import_files" ADD CONSTRAINT "invoice_import_files_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "invoice_import_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_import_product_aliases" ADD CONSTRAINT "invoice_import_product_aliases_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_import_product_aliases" ADD CONSTRAINT "invoice_import_product_aliases_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

