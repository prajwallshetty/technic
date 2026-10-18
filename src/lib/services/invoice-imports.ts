import "server-only";

import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { InvoiceImportStatus } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError, isPrismaUniqueViolation } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { round2 } from "@/lib/money";
import { computeTaxSummary } from "@/lib/tax";
import { createPurchaseOrder } from "@/lib/services/purchases";
import type { DraftInvoice, DraftLine } from "@/lib/invoice-import/draft";
import { ProductMatcher, partyKeyFor } from "@/lib/invoice-import/matching";
import { compactKey } from "@/lib/invoice-import/normalize";
import { OcrUnavailableError } from "@/lib/invoice-import/ocr";
import { DocumentReadError } from "@/lib/invoice-import/pdf-text";
import { evaluateDraft, extractDocument, SUPPORTED_MIME_TYPES, type Evaluation } from "@/lib/invoice-import/pipeline";
import type { ExtractionIssue } from "@/lib/invoice-import/types";
import { ArchiveError, detectMimeType, isZip, readZip } from "@/lib/invoice-import/zip";

/**
 * Bulk invoice import service.
 *
 * Lifecycle of a document:
 *   QUEUED → PROCESSING → READY | NEEDS_REVIEW | DUPLICATE | FAILED
 *   READY/NEEDS_REVIEW → (reviewer edits) → APPROVED → POSTED (purchase only)
 *   any non-final state → REJECTED
 *
 * Guarantees:
 *   - Extraction and approval never touch stock, payments or ledgers. An
 *     approved supplier invoice becomes a DRAFT purchase order created by the
 *     existing purchases service; stock only moves when goods are received
 *     through the normal Purchases workflow.
 *   - The original extraction is immutable; edits go to `draft` and every
 *     change is written to the audit log with before/after values.
 *   - An invoice can be approved once per firm (unique importKey), and
 *     uploads are de-duplicated by content hash and invoice number.
 */

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 10 * 60 * 1000;

/** Errors a reviewer may consciously accept (with a reason) before approval. */
export const ACKNOWLEDGEABLE_CODES = new Set([
  "GROSS_MISMATCH",
  "TAXABLE_MISMATCH",
  "CGST_MISMATCH",
  "SGST_MISMATCH",
  "IGST_MISMATCH",
  "GRAND_TOTAL_MISMATCH",
  "ROUND_OFF_MISMATCH",
  "AMOUNT_IN_WORDS_MISMATCH",
  "LINE_AMOUNT_MISMATCH",
  "TAX_TYPE_MISMATCH",
  "DATE_IN_FUTURE",
  "DRAFT_TOTAL_DIFFERENCE",
]);

export interface Acknowledgement {
  code: string;
  field: string | null;
  reason: string;
  userId: string;
  at: string;
}

export interface Assignments {
  /** lineNo → productId confirmed by a reviewer. */
  products: Record<string, string>;
  /** Supplier chosen for a purchase invoice (auto-filled from GSTIN when unique). */
  supplierId?: string | null;
}

interface Actor {
  firmId: string;
  userId: string;
  branchId?: string | null;
}

// ===========================================================================
// Upload
// ===========================================================================

export interface UploadedFile {
  filename: string;
  data: Buffer;
}

export interface BatchCreationResult {
  batchId: string;
  queued: number;
  duplicates: number;
  skipped: Array<{ path: string; reason: string }>;
}

export async function createImportBatch(
  actor: Actor & { name?: string },
  uploads: UploadedFile[],
): Promise<BatchCreationResult> {
  if (uploads.length === 0) throw new BusinessRuleError("Choose at least one PDF, image or ZIP file");

  const skipped: Array<{ path: string; reason: string }> = [];
  const candidates: Array<{ path: string; name: string; data: Buffer; mimeType: string }> = [];

  for (const upload of uploads) {
    if (isZip(upload.data) && !/\.(xlsx|docx|pptx|ods|odt)$/i.test(upload.filename)) {
      try {
        const contents = readZip(upload.data);
        skipped.push(...contents.skipped.map((s) => ({ path: `${upload.filename}!/${s.path}`, reason: s.reason })));
        for (const file of contents.files) {
          const mimeType = detectMimeType(file.data, file.name);
          const path = `${upload.filename}!/${file.path}`;
          if (mimeType && (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)) {
            candidates.push({ path, name: file.name, data: file.data, mimeType });
          } else {
            skipped.push({ path, reason: unsupportedReason(mimeType) });
          }
        }
      } catch (error) {
        if (error instanceof ArchiveError) {
          skipped.push({ path: upload.filename, reason: error.message });
          continue;
        }
        throw error;
      }
      continue;
    }
    const mimeType = detectMimeType(upload.data, upload.filename);
    if (mimeType && (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType)) {
      candidates.push({ path: upload.filename, name: upload.filename, data: upload.data, mimeType });
    } else {
      skipped.push({ path: upload.filename, reason: unsupportedReason(mimeType) });
    }
  }

  // De-duplicate identical files inside this upload, then against earlier uploads.
  const byHash = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const hash = sha256(candidate.data);
    const first = byHash.get(hash);
    if (first) skipped.push({ path: candidate.path, reason: `Identical to ${first.path} in this upload` });
    else byHash.set(hash, candidate);
  }
  const earlier = await prisma.invoiceImportDocument.findMany({
    where: { firmId: actor.firmId, sha256: { in: [...byHash.keys()] }, status: { notIn: ["REJECTED"] } },
    select: { id: true, sha256: true, sourceFilename: true, batchId: true },
  });
  const earlierByHash = new Map(earlier.map((d) => [d.sha256, d]));

  if (byHash.size === 0 && skipped.length === 0) throw new BusinessRuleError("No files found in the upload");

  const batch = await prisma.invoiceImportBatch.create({
    data: {
      firmId: actor.firmId,
      branchId: actor.branchId ?? null,
      name: actor.name?.trim() || uploads.map((u) => u.filename).join(", ").slice(0, 120),
      status: byHash.size > 0 ? "QUEUED" : "COMPLETED",
      totalFiles: byHash.size,
      skippedFiles: skipped as unknown as Prisma.InputJsonValue,
      createdById: actor.userId,
      completedAt: byHash.size > 0 ? null : new Date(),
    },
  });

  let duplicates = 0;
  for (const [hash, file] of byHash) {
    const prior = earlierByHash.get(hash);
    if (prior) duplicates++;
    await prisma.$transaction(async (tx) => {
      const doc = await tx.invoiceImportDocument.create({
        data: {
          firmId: actor.firmId,
          batchId: batch.id,
          sourceFilename: file.name,
          sourcePath: file.path,
          sha256: hash,
          mimeType: file.mimeType,
          fileSize: file.data.length,
          status: prior ? "DUPLICATE" : "QUEUED",
          duplicateOfId: prior?.id ?? null,
          duplicateReason: prior ? `Same file already uploaded as ${prior.sourceFilename}` : null,
        },
      });
      await tx.invoiceImportFile.create({ data: { documentId: doc.id, data: new Uint8Array(file.data) } });
    });
  }

  await recordAudit({
    action: "INVOICE_IMPORT_UPLOADED",
    entity: "InvoiceImportBatch",
    entityId: batch.id,
    summary: `${byHash.size} document(s) queued, ${duplicates} already uploaded, ${skipped.length} skipped`,
    firmId: actor.firmId,
    branchId: actor.branchId ?? null,
    userId: actor.userId,
    after: { files: uploads.map((u) => ({ name: u.filename, bytes: u.data.length })), skipped },
  });

  return { batchId: batch.id, queued: byHash.size - duplicates, duplicates, skipped };
}

function unsupportedReason(mimeType: string | null): string {
  if (mimeType === "application/vnd.office" || mimeType === "text/spreadsheet") {
    return "Spreadsheets and Office documents are not invoices this importer can read — export them to PDF";
  }
  return `Unsupported file type${mimeType ? ` (${mimeType})` : ""}; upload PDF, PNG, JPEG or TIFF`;
}

function sha256(data: Buffer) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ===========================================================================
// Background processing
// ===========================================================================

export interface ProcessResult {
  processed: number;
  failed: number;
  remaining: number;
}

/**
 * Processes queued documents until the queue is empty, `limit` is reached or
 * the time budget runs out. Safe to call concurrently: each document is
 * claimed with a conditional update, and abandoned claims are reclaimed after
 * STALE_LOCK_MS.
 */
export async function processQueuedDocuments(options: {
  firmId: string;
  batchId?: string;
  limit?: number;
  timeBudgetMs?: number;
}): Promise<ProcessResult> {
  const started = Date.now();
  const limit = options.limit ?? 25;
  const budget = options.timeBudgetMs ?? 45_000;
  let processed = 0;
  let failed = 0;
  let context: ProcessingContext | null = null;

  while (processed + failed < limit && Date.now() - started < budget) {
    const claimed = await claimNext(options.firmId, options.batchId);
    if (!claimed) break;
    context ??= await loadProcessingContext(options.firmId);
    const ok = await processClaimed(claimed.id, context);
    if (ok) processed++;
    else failed++;
  }

  const batchIds = options.batchId
    ? [options.batchId]
    : (
        await prisma.invoiceImportBatch.findMany({
          where: { firmId: options.firmId, status: { in: ["QUEUED", "PROCESSING"] } },
          select: { id: true },
        })
      ).map((b) => b.id);
  for (const batchId of batchIds) await refreshBatchStatus(batchId);

  const remaining = await prisma.invoiceImportDocument.count({
    where: { firmId: options.firmId, ...(options.batchId ? { batchId: options.batchId } : {}), status: { in: ["QUEUED", "PROCESSING"] } },
  });
  return { processed, failed, remaining };
}

async function claimNext(firmId: string, batchId?: string) {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const candidates = await prisma.invoiceImportDocument.findMany({
    where: {
      firmId,
      ...(batchId ? { batchId } : {}),
      OR: [{ status: "QUEUED" }, { status: "PROCESSING", lockedAt: { lt: staleBefore } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, lockedAt: true, batchId: true },
    take: 5,
  });
  for (const candidate of candidates) {
    const result = await prisma.invoiceImportDocument.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        lockedAt: candidate.lockedAt,
      },
      data: { status: "PROCESSING", lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (result.count === 1) {
      await prisma.invoiceImportBatch.updateMany({
        where: { id: candidate.batchId, status: "QUEUED" },
        data: { status: "PROCESSING" },
      });
      return candidate;
    }
  }
  return null;
}

interface ProcessingContext {
  firmGstin: string | null;
  matcher: ProductMatcher;
  suppliersByGstin: Map<string, string[]>;
}

async function loadProcessingContext(firmId: string): Promise<ProcessingContext> {
  const [firm, products, aliases, suppliers] = await Promise.all([
    prisma.firm.findUnique({ where: { id: firmId }, select: { gstin: true } }),
    prisma.product.findMany({
      where: { firmId },
      select: { id: true, sku: true, name: true, subName: true, barcode: true, modelNumber: true, partNumber: true, hsnCode: true, status: true },
    }),
    prisma.invoiceImportProductAlias.findMany({ where: { firmId }, select: { aliasKey: true, productId: true, partyKey: true } }),
    prisma.supplier.findMany({ where: { firmId, isActive: true, gstin: { not: null } }, select: { id: true, gstin: true } }),
  ]);
  const suppliersByGstin = new Map<string, string[]>();
  for (const s of suppliers) {
    const key = s.gstin!.trim().toUpperCase();
    suppliersByGstin.set(key, [...(suppliersByGstin.get(key) ?? []), s.id]);
  }
  return { firmGstin: firm?.gstin?.trim().toUpperCase() ?? null, matcher: new ProductMatcher(products, aliases), suppliersByGstin };
}

async function processClaimed(documentId: string, ctx: ProcessingContext): Promise<boolean> {
  const doc = await prisma.invoiceImportDocument.findUnique({
    where: { id: documentId },
    include: { file: true },
  });
  if (!doc || !doc.file) {
    await prisma.invoiceImportDocument.update({
      where: { id: documentId },
      data: { status: "FAILED", lockedAt: null, lastError: "Source file is missing" },
    });
    return false;
  }

  try {
    const out = await extractDocument(Buffer.from(doc.file.data), {
      sourceFilename: doc.sourceFilename,
      mimeType: doc.mimeType,
      firmGstin: ctx.firmGstin,
    });
    const assignments: Assignments = { products: {}, supplierId: autoSupplier(out.draft, ctx) };
    const evaluation = await evaluateForFirm(doc.firmId, doc.id, out.draft, assignments, [], ctx, out.extraction.issues);

    await prisma.invoiceImportDocument.update({
      where: { id: doc.id },
      data: {
        ...summaryColumns(out.draft, evaluation),
        status: statusFor(evaluation),
        direction: out.draft.direction,
        extractionMethod: out.text.method,
        layoutId: out.extraction.layoutId,
        pageCount: out.text.pageCount,
        rawText: out.text.plainText,
        extraction: out.extraction as unknown as Prisma.InputJsonValue,
        draft: out.draft as unknown as Prisma.InputJsonValue,
        evaluation: evaluation as unknown as Prisma.InputJsonValue,
        assignments: assignments as unknown as Prisma.InputJsonValue,
        acknowledgements: [],
        lockedAt: null,
        lastError: null,
        processedAt: new Date(),
      },
    });
    await recordAudit({
      action: "INVOICE_IMPORT_PROCESSED",
      entity: "InvoiceImportDocument",
      entityId: doc.id,
      summary: `${doc.sourceFilename}: ${out.draft.invoiceNumber ?? "no number"} — ${evaluation.summary.errors} error(s), ${evaluation.summary.warnings} warning(s)`,
      firmId: doc.firmId,
    });

    // The other half of a duplicate pair was processed before this document
    // existed; re-evaluate it so both sides are flagged.
    const otherIds = new Set(
      evaluation.issues
        .filter((i) => i.code === "DUPLICATE_INVOICE_NUMBER")
        .map((i) => i.details?.otherDocumentId)
        .filter((id): id is string => typeof id === "string"),
    );
    for (const otherId of otherIds) await refreshEvaluation(doc.firmId, otherId, ctx);
    return true;
  } catch (error) {
    const permanent = error instanceof DocumentReadError || error instanceof OcrUnavailableError;
    const message = error instanceof Error ? error.message : String(error);
    const retry = !permanent && doc.attempts < MAX_ATTEMPTS;
    await prisma.invoiceImportDocument.update({
      where: { id: doc.id },
      data: { status: retry ? "QUEUED" : "FAILED", lockedAt: null, lastError: message },
    });
    if (!retry) {
      await recordAudit({
        action: "INVOICE_IMPORT_PROCESSED",
        entity: "InvoiceImportDocument",
        entityId: doc.id,
        summary: `${doc.sourceFilename}: extraction failed — ${message}`,
        firmId: doc.firmId,
      });
    }
    return false;
  }
}

function storedExtractionIssues(extraction: unknown): ExtractionIssue[] {
  return ((extraction as { issues?: ExtractionIssue[] } | null)?.issues ?? []).filter(Boolean);
}

/** Re-validates a stored draft (e.g. after a related document changed). */
async function refreshEvaluation(firmId: string, documentId: string, ctx: ProcessingContext) {
  const doc = await prisma.invoiceImportDocument.findFirst({ where: { id: documentId, firmId } });
  if (!doc?.draft || !EDITABLE_STATUSES.includes(doc.status)) return;
  const draft = doc.draft as unknown as DraftInvoice;
  const assignments = (doc.assignments as unknown as Assignments) ?? { products: {} };
  const acks = ((doc.acknowledgements as unknown as Acknowledgement[]) ?? []).filter(Boolean);
  const evaluation = await evaluateForFirm(firmId, doc.id, draft, assignments, acks, ctx, storedExtractionIssues(doc.extraction));
  await prisma.invoiceImportDocument.update({
    where: { id: doc.id },
    data: { evaluation: evaluation as unknown as Prisma.InputJsonValue, status: statusFor(evaluation), ...summaryColumns(draft, evaluation) },
  });
}

function autoSupplier(draft: DraftInvoice, ctx: ProcessingContext): string | null {
  if (draft.direction !== "PURCHASE" || !draft.partyGstin) return null;
  const ids = ctx.suppliersByGstin.get(draft.partyGstin.toUpperCase()) ?? [];
  return ids.length === 1 ? ids[0] : null;
}

async function refreshBatchStatus(batchId: string) {
  const pending = await prisma.invoiceImportDocument.count({ where: { batchId, status: { in: ["QUEUED", "PROCESSING"] } } });
  if (pending === 0) {
    await prisma.invoiceImportBatch.updateMany({
      where: { id: batchId, status: { in: ["QUEUED", "PROCESSING"] } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
}

export async function getBatchProgress(firmId: string, batchId: string) {
  const batch = await prisma.invoiceImportBatch.findFirst({ where: { id: batchId, firmId } });
  if (!batch) throw new NotFoundError("Import batch not found");
  const grouped = await prisma.invoiceImportDocument.groupBy({
    by: ["status"],
    where: { batchId },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<InvoiceImportStatus, number>>;
  const total = grouped.reduce((n, g) => n + g._count._all, 0);
  const pending = (counts.QUEUED ?? 0) + (counts.PROCESSING ?? 0);
  return { status: batch.status, total, pending, done: total - pending, counts };
}

// ===========================================================================
// Evaluation (validation + matching + duplicate detection)
// ===========================================================================

async function evaluateForFirm(
  firmId: string,
  documentId: string,
  draft: DraftInvoice,
  assignments: Assignments,
  acknowledgements: Acknowledgement[],
  ctx: ProcessingContext,
  extractionIssues: ExtractionIssue[] = [],
): Promise<Evaluation> {
  const productAssignments = new Map(
    Object.entries(assignments.products ?? {}).map(([lineNo, productId]) => [Number(lineNo), { productId, method: "MANUAL" as const }]),
  );
  // Parser warnings (overflowed cells, merged rows) describe the source and
  // always carry over; errors are re-derived from the current values, so a
  // corrected field clears its error.
  const carried = extractionIssues.filter((i) => i.severity !== "ERROR");
  const evaluation = evaluateDraft(draft, { firmGstin: ctx.firmGstin, matcher: ctx.matcher, assignments: productAssignments }, carried);

  // Duplicates: another import of the same invoice, or the invoice already in the ERP.
  const duplicates = await findDuplicates(firmId, documentId, draft);
  evaluation.issues.push(...duplicates);

  if (draft.direction === "PURCHASE" && !assignments.supplierId) {
    evaluation.issues.push({
      code: "SUPPLIER_NOT_SELECTED",
      severity: "ERROR",
      message: draft.partyGstin
        ? `No single supplier with GSTIN ${draft.partyGstin} exists — create or choose the supplier`
        : "Choose the supplier for this purchase invoice",
      field: "partyName",
    });
  }

  // Mark acknowledged issues so the UI and approval can tell them apart.
  for (const issue of evaluation.issues) {
    const ack = acknowledgements.find((a) => a.code === issue.code && (a.field ?? null) === (issue.field ?? null));
    if (ack) (issue.details ??= {}).acknowledged = { reason: ack.reason, userId: ack.userId, at: ack.at };
  }
  evaluation.summary.errors = evaluation.issues.filter((i) => i.severity === "ERROR" && !i.details?.acknowledged).length;
  evaluation.summary.warnings = evaluation.issues.filter((i) => i.severity === "WARNING").length;
  return evaluation;
}

async function findDuplicates(firmId: string, documentId: string, draft: DraftInvoice): Promise<ExtractionIssue[]> {
  if (!draft.invoiceNumber) return [];
  const issues: ExtractionIssue[] = [];
  const others = await prisma.invoiceImportDocument.findMany({
    where: {
      firmId,
      id: { not: documentId },
      invoiceNumber: draft.invoiceNumber,
      direction: draft.direction,
      status: { notIn: ["REJECTED", "FAILED", "QUEUED", "PROCESSING"] },
    },
    select: { id: true, sourceFilename: true, partyGstin: true, partyName: true, status: true },
  });
  const party = partyKeyFor(draft.partyGstin, draft.partyName);
  for (const other of others) {
    const sameParty = partyKeyFor(other.partyGstin, other.partyName) === party;
    // On sales invoices the number is ours and unique regardless of customer.
    if (draft.direction === "SALES" || sameParty) {
      issues.push({
        code: "DUPLICATE_INVOICE_NUMBER",
        severity: "ERROR",
        message: `Invoice number ${draft.invoiceNumber} is also in ${other.sourceFilename} (${other.status.toLowerCase().replace("_", " ")})${sameParty ? "" : " for a different customer"}`,
        field: "invoiceNumber",
        details: { otherDocumentId: other.id },
      });
    }
  }

  if (draft.direction === "SALES") {
    const existing = await prisma.invoice.findFirst({
      where: { firmId, invoiceNumber: draft.invoiceNumber },
      select: { id: true, invoiceNumber: true, totalAmount: true },
    });
    if (existing) {
      issues.push({
        code: "ALREADY_IN_ERP",
        severity: "ERROR",
        message: `ERP invoice ${existing.invoiceNumber} already exists (total ${Number(existing.totalAmount).toFixed(2)})`,
        field: "invoiceNumber",
        details: { invoiceId: existing.id },
      });
    }
  } else if (draft.direction === "PURCHASE" && draft.partyGstin) {
    const existing = await prisma.purchaseInvoice.findFirst({
      where: {
        firmId,
        supplier: { gstin: draft.partyGstin },
        OR: [{ supplierRef: draft.invoiceNumber }, { invoiceNumber: draft.invoiceNumber }],
      },
      select: { id: true, invoiceNumber: true },
    });
    if (existing) {
      issues.push({
        code: "ALREADY_IN_ERP",
        severity: "ERROR",
        message: `Supplier bill ${existing.invoiceNumber} with this reference already exists in Purchases`,
        field: "invoiceNumber",
        details: { purchaseInvoiceId: existing.id },
      });
    }
  }
  return issues;
}

function statusFor(evaluation: Evaluation): InvoiceImportStatus {
  if (evaluation.issues.some((i) => (i.code === "DUPLICATE_INVOICE_NUMBER" || i.code === "ALREADY_IN_ERP") && !i.details?.acknowledged)) {
    return "DUPLICATE";
  }
  return evaluation.summary.errors > 0 ? "NEEDS_REVIEW" : "READY";
}

function summaryColumns(draft: DraftInvoice, evaluation: Evaluation) {
  return {
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate ? new Date(`${draft.invoiceDate}T00:00:00Z`) : null,
    partyName: draft.partyName,
    partyGstin: draft.partyGstin,
    grandTotal: draft.totals.grandTotal,
    calculatedTotal: evaluation.reconciliation.calculated.complete ? evaluation.reconciliation.calculated.grandTotal : null,
    confidence: evaluation.confidence,
    errorCount: evaluation.summary.errors,
    warningCount: evaluation.summary.warnings,
    duplicateReason:
      evaluation.issues.find((i) => i.code === "DUPLICATE_INVOICE_NUMBER" || i.code === "ALREADY_IN_ERP")?.message ?? null,
  };
}

// ===========================================================================
// Review
// ===========================================================================

const EDITABLE_STATUSES: InvoiceImportStatus[] = ["READY", "NEEDS_REVIEW", "DUPLICATE"];

async function loadDocument(firmId: string, documentId: string) {
  const doc = await prisma.invoiceImportDocument.findFirst({ where: { id: documentId, firmId } });
  if (!doc) throw new NotFoundError("Imported document not found");
  return doc;
}

export interface ReviewInput {
  draft: DraftInvoice;
  productAssignments: Record<string, string | null>;
  supplierId?: string | null;
  rememberAliases?: boolean;
}

/** Saves reviewer corrections, re-validates, and audits every changed field. */
export async function saveReview(actor: Actor, documentId: string, input: ReviewInput) {
  const doc = await loadDocument(actor.firmId, documentId);
  if (!EDITABLE_STATUSES.includes(doc.status)) {
    throw new BusinessRuleError(`A ${doc.status.toLowerCase()} document cannot be edited`);
  }
  const before = doc.draft as unknown as DraftInvoice;
  const beforeAssignments = (doc.assignments as unknown as Assignments) ?? { products: {} };
  const draft = sanitizeDraft(input.draft, before);

  // Validate product ids belong to this firm.
  const wanted = Object.values(input.productAssignments).filter((id): id is string => Boolean(id));
  if (wanted.length) {
    const found = await prisma.product.findMany({ where: { id: { in: wanted }, firmId: actor.firmId }, select: { id: true } });
    if (found.length !== new Set(wanted).size) throw new BusinessRuleError("One of the chosen products does not belong to this firm");
  }
  if (input.supplierId) {
    const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, firmId: actor.firmId }, select: { id: true } });
    if (!supplier) throw new BusinessRuleError("Supplier not found");
  }

  const products: Record<string, string> = {};
  const validLineNos = new Set(draft.lines.filter((l) => l.kind === "ITEM").map((l) => String(l.lineNo)));
  for (const [lineNo, productId] of Object.entries(input.productAssignments)) {
    if (productId && validLineNos.has(lineNo)) products[lineNo] = productId;
  }
  const assignments: Assignments = {
    products,
    supplierId: draft.direction === "PURCHASE" ? (input.supplierId ?? beforeAssignments.supplierId ?? null) : null,
  };

  const ctx = await loadProcessingContext(actor.firmId);
  const acknowledgements = ((doc.acknowledgements as unknown as Acknowledgement[]) ?? []).filter(Boolean);
  const evaluation = await evaluateForFirm(actor.firmId, doc.id, draft, assignments, acknowledgements, ctx, storedExtractionIssues(doc.extraction));

  // Remember confirmed products so the same text matches automatically next time.
  const aliasesSaved: string[] = [];
  if (input.rememberAliases) {
    const partyKey = draft.direction === "PURCHASE" ? partyKeyFor(draft.partyGstin, draft.partyName) : "";
    for (const [lineNo, productId] of Object.entries(products)) {
      if (beforeAssignments.products?.[lineNo] === productId) continue;
      const line = draft.lines.find((l) => String(l.lineNo) === lineNo);
      const aliasKey = compactKey(line?.description);
      if (!line || !aliasKey) continue;
      await prisma.invoiceImportProductAlias.upsert({
        where: { firmId_partyKey_aliasKey: { firmId: actor.firmId, partyKey, aliasKey } },
        create: { firmId: actor.firmId, partyKey, aliasKey, rawText: line.description ?? "", productId, createdById: actor.userId },
        update: { productId, rawText: line.description ?? "", createdById: actor.userId },
      });
      aliasesSaved.push(`${line.description} → ${productId}`);
    }
  }

  const changes = diffDrafts(before, draft);
  for (const [lineNo, productId] of Object.entries(products)) {
    if (beforeAssignments.products?.[lineNo] !== productId) changes.push({ field: `lines.${lineNo}.product`, before: beforeAssignments.products?.[lineNo] ?? null, after: productId });
  }
  if ((beforeAssignments.supplierId ?? null) !== (assignments.supplierId ?? null)) {
    changes.push({ field: "supplierId", before: beforeAssignments.supplierId ?? null, after: assignments.supplierId ?? null });
  }

  await prisma.invoiceImportDocument.update({
    where: { id: doc.id },
    data: {
      ...summaryColumns(draft, evaluation),
      direction: draft.direction,
      status: statusFor(evaluation),
      draft: draft as unknown as Prisma.InputJsonValue,
      evaluation: evaluation as unknown as Prisma.InputJsonValue,
      assignments: assignments as unknown as Prisma.InputJsonValue,
      reviewedById: actor.userId,
      reviewedAt: new Date(),
    },
  });

  if (changes.length || aliasesSaved.length) {
    await recordAudit({
      action: "INVOICE_IMPORT_EDITED",
      entity: "InvoiceImportDocument",
      entityId: doc.id,
      summary: `${doc.sourceFilename}: ${changes.length} field(s) corrected${aliasesSaved.length ? `, ${aliasesSaved.length} product mapping(s) saved` : ""}`,
      firmId: actor.firmId,
      userId: actor.userId,
      before: Object.fromEntries(changes.map((c) => [c.field, c.before])),
      after: { ...Object.fromEntries(changes.map((c) => [c.field, c.after])), aliasesSaved },
    });
  }
  return { status: statusFor(evaluation), evaluation, changes: changes.length };
}

/** Keeps only known fields with the right types; immutable fields come from `before`. */
function sanitizeDraft(input: DraftInvoice, before: DraftInvoice): DraftInvoice {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? round2(v) : null);
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const direction = ["SALES", "PURCHASE", "UNKNOWN"].includes(input.direction) ? input.direction : before.direction;
  const lines: DraftLine[] = (input.lines ?? []).map((l, index) => ({
    lineNo: index + 1,
    kind: l.kind === "ADJUSTMENT" ? "ADJUSTMENT" : "ITEM",
    description: str(l.description),
    hsn: str(l.hsn),
    sku: str(l.sku),
    barcode: str(l.barcode),
    brand: str(l.brand),
    quantity: num(l.quantity),
    unit: str(l.unit),
    rate: num(l.rate),
    discountPercent: num(l.discountPercent),
    gstRate: num(l.gstRate),
    amount: num(l.amount),
    rawText: before.lines.find((b) => b.lineNo === l.lineNo)?.rawText ?? "(added by reviewer)",
  }));
  const t = input.totals ?? ({} as DraftInvoice["totals"]);
  return {
    ...before,
    direction,
    documentType: str(input.documentType),
    invoiceNumber: str(input.invoiceNumber),
    invoiceDate: date(input.invoiceDate),
    dueDate: date(input.dueDate),
    paymentTerms: str(input.paymentTerms),
    purchaseOrderNumber: str(input.purchaseOrderNumber),
    dispatchThrough: str(input.dispatchThrough),
    ewayBillNumber: str(input.ewayBillNumber),
    currency: str(input.currency),
    placeOfSupply: str(input.placeOfSupply),
    partyName: str(input.partyName),
    partyGstin: str(input.partyGstin)?.toUpperCase() ?? null,
    partyPhone: str(input.partyPhone),
    partyAddress: str(input.partyAddress),
    lines,
    totals: {
      grossAmount: num(t.grossAmount),
      discountPercent: num(t.discountPercent),
      discountAmount: num(t.discountAmount),
      taxableAmount: num(t.taxableAmount),
      cgst: num(t.cgst),
      sgst: num(t.sgst),
      igst: num(t.igst),
      cess: num(t.cess),
      freight: num(t.freight),
      packing: num(t.packing),
      otherCharges: num(t.otherCharges),
      roundOff: num(t.roundOff),
      grandTotal: num(t.grandTotal),
    },
  };
}

function diffDrafts(before: DraftInvoice, after: DraftInvoice) {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  const headerKeys = [
    "direction", "documentType", "invoiceNumber", "invoiceDate", "dueDate", "paymentTerms", "purchaseOrderNumber",
    "dispatchThrough", "ewayBillNumber", "currency", "placeOfSupply", "partyName", "partyGstin", "partyPhone", "partyAddress",
  ] as const;
  for (const key of headerKeys) if ((before[key] ?? null) !== (after[key] ?? null)) changes.push({ field: key, before: before[key], after: after[key] });
  for (const key of Object.keys(after.totals) as Array<keyof DraftInvoice["totals"]>) {
    if ((before.totals[key] ?? null) !== (after.totals[key] ?? null)) changes.push({ field: `totals.${key}`, before: before.totals[key], after: after.totals[key] });
  }
  const lineKeys = ["kind", "description", "hsn", "sku", "quantity", "unit", "rate", "discountPercent", "gstRate", "amount"] as const;
  const count = Math.max(before.lines.length, after.lines.length);
  for (let i = 0; i < count; i++) {
    const b = before.lines[i];
    const a = after.lines[i];
    if (!b || !a) {
      changes.push({ field: `lines.${i + 1}`, before: b ? b.description : null, after: a ? a.description : null });
      continue;
    }
    for (const key of lineKeys) if ((b[key] ?? null) !== (a[key] ?? null)) changes.push({ field: `lines.${i + 1}.${key}`, before: b[key], after: a[key] });
  }
  return changes;
}

export async function acknowledgeIssue(actor: Actor, documentId: string, code: string, fieldPath: string | null, reason: string) {
  if (!ACKNOWLEDGEABLE_CODES.has(code)) throw new BusinessRuleError("This issue must be corrected, not acknowledged");
  if (reason.trim().length < 5) throw new BusinessRuleError("Give a reason (at least 5 characters) for accepting this difference");
  const doc = await loadDocument(actor.firmId, documentId);
  if (!EDITABLE_STATUSES.includes(doc.status)) throw new BusinessRuleError(`A ${doc.status.toLowerCase()} document cannot be changed`);
  const acks = ((doc.acknowledgements as unknown as Acknowledgement[]) ?? []).filter((a) => !(a.code === code && a.field === fieldPath));
  acks.push({ code, field: fieldPath, reason: reason.trim(), userId: actor.userId, at: new Date().toISOString() });

  const ctx = await loadProcessingContext(actor.firmId);
  const draft = doc.draft as unknown as DraftInvoice;
  const evaluation = await evaluateForFirm(actor.firmId, doc.id, draft, doc.assignments as unknown as Assignments, acks, ctx, storedExtractionIssues(doc.extraction));
  await prisma.invoiceImportDocument.update({
    where: { id: doc.id },
    data: {
      acknowledgements: acks as unknown as Prisma.InputJsonValue,
      evaluation: evaluation as unknown as Prisma.InputJsonValue,
      status: statusFor(evaluation),
      ...summaryColumns(draft, evaluation),
    },
  });
  await recordAudit({
    action: "INVOICE_IMPORT_EDITED",
    entity: "InvoiceImportDocument",
    entityId: doc.id,
    summary: `${doc.sourceFilename}: accepted ${code}${fieldPath ? ` on ${fieldPath}` : ""} — ${reason.trim()}`,
    firmId: actor.firmId,
    userId: actor.userId,
    after: { code, field: fieldPath, reason: reason.trim() },
  });
}

/** Re-runs extraction from the stored file. Discards reviewer edits, so it is audited. */
export async function reprocessDocument(actor: Actor, documentId: string) {
  const doc = await loadDocument(actor.firmId, documentId);
  if (!["FAILED", "NEEDS_REVIEW", "READY", "DUPLICATE"].includes(doc.status)) {
    throw new BusinessRuleError(`A ${doc.status.toLowerCase()} document cannot be re-processed`);
  }
  await prisma.invoiceImportDocument.update({
    where: { id: doc.id },
    data: { status: "QUEUED", attempts: 0, lockedAt: null, lastError: null, duplicateOfId: null },
  });
  await prisma.invoiceImportBatch.update({ where: { id: doc.batchId }, data: { status: "QUEUED", completedAt: null } });
  await recordAudit({
    action: "INVOICE_IMPORT_EDITED",
    entity: "InvoiceImportDocument",
    entityId: doc.id,
    summary: `${doc.sourceFilename}: queued for re-extraction (previous review values discarded)`,
    firmId: actor.firmId,
    userId: actor.userId,
    before: { status: doc.status, draft: doc.draft, assignments: doc.assignments },
  });
}

export async function rejectDocument(actor: Actor, documentId: string, reason: string) {
  if (reason.trim().length < 3) throw new BusinessRuleError("Give a reason for rejecting this document");
  const doc = await loadDocument(actor.firmId, documentId);
  if (["APPROVED", "POSTED", "REJECTED"].includes(doc.status)) throw new BusinessRuleError(`A ${doc.status.toLowerCase()} document cannot be rejected`);
  await prisma.invoiceImportDocument.update({
    where: { id: doc.id },
    data: { status: "REJECTED", rejectedById: actor.userId, rejectedAt: new Date(), rejectionReason: reason.trim(), lockedAt: null },
  });
  await recordAudit({
    action: "INVOICE_IMPORT_REJECTED",
    entity: "InvoiceImportDocument",
    entityId: doc.id,
    summary: `${doc.sourceFilename}: rejected — ${reason.trim()}`,
    firmId: actor.firmId,
    userId: actor.userId,
    before: { status: doc.status },
  });
}

// ===========================================================================
// Approval → draft
// ===========================================================================

export interface ApprovalResult {
  status: "APPROVED" | "POSTED";
  message: string;
  postedEntity?: string;
  postedEntityId?: string;
  postedNumber?: string;
}

/**
 * Approves a reviewed document. Validation is re-run against the current
 * catalogue first; any unacknowledged error blocks approval.
 *
 * - PURCHASE: creates a DRAFT purchase order through createPurchaseOrder()
 *   (no stock, no payable). Requires purchase.create.
 * - SALES: the ERP has no draft invoice, and createInvoice() always moves
 *   stock and raises a receivable, so a sales invoice is only marked as
 *   approved here — it is not turned into an ERP invoice automatically.
 */
export async function approveDocument(
  actor: Actor & { branchId: string; canCreatePurchase: boolean },
  documentId: string,
): Promise<ApprovalResult> {
  const doc = await loadDocument(actor.firmId, documentId);
  if (!["READY", "NEEDS_REVIEW", "DUPLICATE"].includes(doc.status)) {
    throw new BusinessRuleError(`A ${doc.status.toLowerCase()} document cannot be approved`);
  }
  const draft = doc.draft as unknown as DraftInvoice;
  const assignments = (doc.assignments as unknown as Assignments) ?? { products: {} };
  const acks = ((doc.acknowledgements as unknown as Acknowledgement[]) ?? []).filter(Boolean);
  const ctx = await loadProcessingContext(actor.firmId);
  const evaluation = await evaluateForFirm(actor.firmId, doc.id, draft, assignments, acks, ctx, storedExtractionIssues(doc.extraction));

  // Purchase drafts are priced with the ERP's own tax engine; if its total
  // would differ from the supplier's invoice, the reviewer must accept that.
  let poPlan: ReturnType<typeof planPurchaseOrder> | null = null;
  if (draft.direction === "PURCHASE") {
    if (!actor.canCreatePurchase) throw new BusinessRuleError("Approving a supplier invoice creates a purchase order — you need the purchase.create permission");
    poPlan = planPurchaseOrder(draft, evaluation);
    if (poPlan && Math.abs(poPlan.difference) > 1) {
      const ack = acks.find((a) => a.code === "DRAFT_TOTAL_DIFFERENCE");
      if (!ack) {
        evaluation.issues.push({
          code: "DRAFT_TOTAL_DIFFERENCE",
          severity: "ERROR",
          message: `The draft purchase order would total ${poPlan.erpTotal.toFixed(2)} but the supplier invoice is ${draft.totals.grandTotal?.toFixed(2)} (difference ${poPlan.difference.toFixed(2)}) — ${poPlan.reason}`,
          field: "totals.grandTotal",
        });
      }
    }
  }

  const blocking = evaluation.issues.filter((i) => i.severity === "ERROR" && !i.details?.acknowledged);
  if (blocking.length) {
    await prisma.invoiceImportDocument.update({
      where: { id: doc.id },
      data: { evaluation: evaluation as unknown as Prisma.InputJsonValue, status: statusFor(evaluation), ...summaryColumns(draft, evaluation) },
    });
    throw new BusinessRuleError(
      `Resolve ${blocking.length} issue(s) before approving: ${blocking.slice(0, 3).map((i) => i.message).join("; ")}${blocking.length > 3 ? "; …" : ""}`,
    );
  }

  const importKey = `${draft.direction}|${draft.direction === "SALES" ? "" : partyKeyFor(draft.partyGstin, draft.partyName)}|${compactKey(draft.invoiceNumber)}`;
  try {
    // Conditional update = optimistic lock: only one approver wins.
    const claimed = await prisma.invoiceImportDocument.updateMany({
      where: { id: doc.id, status: doc.status, importKey: null },
      data: { status: "APPROVED", importKey, approvedById: actor.userId, approvedAt: new Date() },
    });
    if (claimed.count !== 1) throw new BusinessRuleError("This document was changed by someone else — reload and try again");
  } catch (error) {
    if (isPrismaUniqueViolation(error)) throw new BusinessRuleError("This invoice has already been approved from another uploaded document");
    throw error;
  }

  await recordAudit({
    action: "INVOICE_IMPORT_APPROVED",
    entity: "InvoiceImportDocument",
    entityId: doc.id,
    summary: `${doc.sourceFilename}: ${draft.direction.toLowerCase()} invoice ${draft.invoiceNumber} approved (total ${draft.totals.grandTotal?.toFixed(2)})`,
    firmId: actor.firmId,
    userId: actor.userId,
    after: { importKey, acknowledgements: acks, grandTotal: draft.totals.grandTotal },
  });

  if (draft.direction !== "PURCHASE" || !poPlan) {
    return {
      status: "APPROVED",
      message:
        "Approved and kept as a reviewed record. No ERP invoice was created: sales invoices cannot be drafted, and creating one would deduct stock and raise a receivable.",
    };
  }

  try {
    const po = await createPurchaseOrder({
      firmId: actor.firmId,
      branchId: actor.branchId,
      supplierId: assignments.supplierId!,
      taxMode: "GST",
      notes: [
        `Imported from ${doc.sourceFilename} — supplier invoice ${draft.invoiceNumber} dated ${draft.invoiceDate}, total ₹${draft.totals.grandTotal?.toFixed(2)}.`,
        "Draft only: receive goods through Purchases to update stock.",
        poPlan.notes,
      ]
        .filter(Boolean)
        .join(" "),
      lines: poPlan.lines,
      userId: actor.userId,
    });
    await prisma.invoiceImportDocument.update({
      where: { id: doc.id },
      data: { status: "POSTED", postedEntity: "PurchaseOrder", postedEntityId: po.id, postedAt: new Date() },
    });
    await recordAudit({
      action: "INVOICE_IMPORT_POSTED",
      entity: "InvoiceImportDocument",
      entityId: doc.id,
      summary: `${doc.sourceFilename}: draft purchase order ${po.poNumber} created`,
      firmId: actor.firmId,
      userId: actor.userId,
      after: { purchaseOrderId: po.id, poNumber: po.poNumber, erpTotal: Number(po.total), invoiceTotal: draft.totals.grandTotal },
    });
    return { status: "POSTED", message: `Draft purchase order ${po.poNumber} created`, postedEntity: "PurchaseOrder", postedEntityId: po.id, postedNumber: po.poNumber };
  } catch (error) {
    // Roll the approval back so the document can be fixed and approved again.
    await prisma.invoiceImportDocument.update({
      where: { id: doc.id },
      data: { status: doc.status, importKey: null, approvedById: null, approvedAt: null },
    });
    throw error;
  }
}

/**
 * Maps a supplier invoice onto purchase-order lines. The ERP prices lines
 * GST-inclusive (see computeTaxSummary), so exclusive invoice rates are
 * grossed up, and the header discount becomes a per-line discount %. Charge
 * lines (freight, line-level discounts) have no product and cannot be carried,
 * which is why the resulting total is compared with the invoice.
 */
function planPurchaseOrder(draft: DraftInvoice, evaluation: Evaluation) {
  const productByLine = new Map(evaluation.matches.map((m) => [m.lineNo, m.match.productId]));
  const items = draft.lines.filter((l) => l.kind === "ITEM" && (l.quantity ?? 0) > 0);
  const adjustments = draft.lines.filter((l) => l.kind === "ADJUSTMENT" && (l.amount ?? 0) !== 0);
  const gross = draft.totals.grossAmount ?? items.reduce((n, l) => n + (l.amount ?? 0), 0);
  const headerDiscountPct = gross > 0 && draft.totals.discountAmount ? round2((draft.totals.discountAmount / gross) * 100) : 0;

  const lines = items.map((l) => {
    const rate = l.rate ?? (l.quantity ? (l.amount ?? 0) / l.quantity : 0);
    const gst = l.gstRate ?? 0;
    return {
      productId: productByLine.get(l.lineNo)!,
      quantity: Math.round(l.quantity ?? 0),
      unitPrice: round2(rate * (1 + gst / 100)),
      discountPercent: headerDiscountPct,
      gstRate: gst,
      descriptionOverride: l.description ?? undefined,
    };
  });
  const summary = computeTaxSummary(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, gstRate: l.gstRate })), {
    mode: "GST",
    sameState: !(evaluation.reconciliation.calculated.interState ?? false),
  });
  const erpTotal = summary.totalAmount;
  const difference = round2((draft.totals.grandTotal ?? 0) - erpTotal);
  const fractional = items.some((l) => l.quantity !== null && !Number.isInteger(l.quantity));
  const reason = adjustments.length
    ? `${adjustments.length} discount/charge line(s) cannot be carried onto a purchase order`
    : fractional
      ? "fractional quantities are rounded to whole units"
      : "per-line rounding in the ERP tax engine";
  const notes = adjustments.length
    ? `Not carried: ${adjustments.map((a) => `${a.description} ${a.amount?.toFixed(2)}`).join(", ")}.`
    : "";
  return { lines, erpTotal, difference, reason, notes };
}

// ===========================================================================
// Queries
// ===========================================================================

export async function listBatches(firmId: string) {
  const batches = await prisma.invoiceImportBatch.findMany({ where: { firmId }, orderBy: { createdAt: "desc" }, take: 50 });
  const counts = await prisma.invoiceImportDocument.groupBy({
    by: ["batchId", "status"],
    where: { batchId: { in: batches.map((b) => b.id) } },
    _count: { _all: true },
  });
  return batches.map((b) => {
    const mine = counts.filter((c) => c.batchId === b.id);
    const by = Object.fromEntries(mine.map((c) => [c.status, c._count._all])) as Partial<Record<InvoiceImportStatus, number>>;
    return { ...b, counts: by, documents: mine.reduce((n, c) => n + c._count._all, 0) };
  });
}

export async function listBatchDocuments(firmId: string, batchId: string) {
  const batch = await prisma.invoiceImportBatch.findFirst({ where: { id: batchId, firmId } });
  if (!batch) throw new NotFoundError("Import batch not found");
  const documents = await prisma.invoiceImportDocument.findMany({
    where: { batchId },
    orderBy: [{ sourceFilename: "asc" }],
    select: {
      id: true, sourceFilename: true, sourcePath: true, status: true, direction: true, invoiceNumber: true, invoiceDate: true,
      partyName: true, partyGstin: true, grandTotal: true, calculatedTotal: true, confidence: true, errorCount: true,
      warningCount: true, lastError: true, attempts: true, duplicateReason: true, evaluation: true, pageCount: true,
      extractionMethod: true, postedEntity: true, postedEntityId: true,
    },
  });
  return {
    batch,
    documents: documents
      .map(({ evaluation, ...d }) => {
        const summary = (evaluation as unknown as Evaluation | null)?.summary;
        return { ...d, grandTotal: num(d.grandTotal), calculatedTotal: num(d.calculatedTotal), confidence: num(d.confidence), lineSummary: summary ?? null };
      })
      .sort((a, b) => a.sourceFilename.localeCompare(b.sourceFilename, undefined, { numeric: true })),
  };
}

export async function getDocumentForReview(firmId: string, documentId: string) {
  const doc = await prisma.invoiceImportDocument.findFirst({
    where: { id: documentId, firmId },
    include: { batch: { select: { id: true, name: true } } },
  });
  if (!doc) throw new NotFoundError("Imported document not found");
  const assignments = (doc.assignments as unknown as Assignments) ?? { products: {} };
  const evaluation = doc.evaluation as unknown as Evaluation | null;
  const productIds = new Set<string>(Object.values(assignments.products ?? {}));
  for (const m of evaluation?.matches ?? []) {
    if (m.match.productId) productIds.add(m.match.productId);
    for (const c of m.match.candidates) productIds.add(c.productId);
  }
  const [products, supplier] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: [...productIds] }, firmId }, select: { id: true, sku: true, name: true } }),
    assignments.supplierId ? prisma.supplier.findFirst({ where: { id: assignments.supplierId, firmId }, select: { id: true, name: true, gstin: true } }) : null,
  ]);
  return {
    id: doc.id,
    batch: doc.batch,
    sourceFilename: doc.sourceFilename,
    sourcePath: doc.sourcePath,
    mimeType: doc.mimeType,
    status: doc.status,
    direction: doc.direction,
    extractionMethod: doc.extractionMethod,
    pageCount: doc.pageCount,
    lastError: doc.lastError,
    attempts: doc.attempts,
    draft: doc.draft as unknown as DraftInvoice | null,
    extraction: doc.extraction,
    evaluation,
    assignments,
    acknowledgements: ((doc.acknowledgements as unknown as Acknowledgement[]) ?? []).filter(Boolean),
    products,
    supplier,
    rejectionReason: doc.rejectionReason,
    postedEntity: doc.postedEntity,
    postedEntityId: doc.postedEntityId,
    approvedAt: doc.approvedAt,
    reviewedAt: doc.reviewedAt,
  };
}

export async function getDocumentFile(firmId: string, documentId: string) {
  const doc = await prisma.invoiceImportDocument.findFirst({
    where: { id: documentId, firmId },
    select: { sourceFilename: true, mimeType: true, file: true },
  });
  if (!doc?.file) throw new NotFoundError("File not found");
  return { filename: doc.sourceFilename, mimeType: doc.mimeType, data: Buffer.from(doc.file.data) };
}

function num(value: { toNumber(): number } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : value.toNumber();
}
