"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";
import { authorize, hasPermission, requireFirmId, requireWriteBranch } from "@/lib/session";
import type { DraftInvoice } from "@/lib/invoice-import/draft";
import {
  acknowledgeIssue,
  approveDocument,
  getBatchProgress,
  processQueuedDocuments,
  rejectDocument,
  reprocessDocument,
  saveReview,
} from "@/lib/services/invoice-imports";

/**
 * Advances a batch's queue a few documents at a time while its page is open,
 * so processing survives serverless time limits without a separate worker.
 */
export async function pumpBatchAction(batchId: string) {
  return runAction(async () => {
    const user = await authorize("invoice_import.view");
    const firmId = requireFirmId(user);
    const before = await getBatchProgress(firmId, batchId);
    if (before.pending > 0) {
      await processQueuedDocuments({ firmId, batchId, limit: 5, timeBudgetMs: 20_000 });
    }
    return getBatchProgress(firmId, batchId);
  });
}

export async function saveReviewAction(
  documentId: string,
  input: { draft: DraftInvoice; productAssignments: Record<string, string | null>; supplierId?: string | null; rememberAliases?: boolean },
) {
  return runAction(async () => {
    const user = await authorize("invoice_import.manage");
    const result = await saveReview({ firmId: requireFirmId(user), userId: user.id }, documentId, input);
    revalidatePath(`/invoice-imports/documents/${documentId}`);
    return { status: result.status, changes: result.changes };
  });
}

export async function acknowledgeIssueAction(documentId: string, code: string, field: string | null, reason: string) {
  return runAction(async () => {
    const user = await authorize("invoice_import.approve");
    await acknowledgeIssue({ firmId: requireFirmId(user), userId: user.id }, documentId, code, field, reason);
    revalidatePath(`/invoice-imports/documents/${documentId}`);
  });
}

export async function approveDocumentAction(documentId: string) {
  return runAction(async () => {
    const user = await authorize("invoice_import.approve");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);
    const result = await approveDocument(
      { firmId, userId: user.id, branchId, canCreatePurchase: hasPermission(user, "purchase.create") },
      documentId,
    );
    revalidatePath(`/invoice-imports/documents/${documentId}`);
    revalidatePath("/purchases");
    return result;
  });
}

export async function rejectDocumentAction(documentId: string, reason: string) {
  return runAction(async () => {
    const user = await authorize("invoice_import.manage");
    await rejectDocument({ firmId: requireFirmId(user), userId: user.id }, documentId, reason);
    revalidatePath(`/invoice-imports/documents/${documentId}`);
  });
}

export async function reprocessDocumentAction(documentId: string) {
  return runAction(async () => {
    const user = await authorize("invoice_import.manage");
    await reprocessDocument({ firmId: requireFirmId(user), userId: user.id }, documentId);
    revalidatePath(`/invoice-imports/documents/${documentId}`);
  });
}

export async function searchCatalogueAction(query: string) {
  return runAction(async () => {
    const user = await authorize("invoice_import.manage");
    const q = query.trim();
    const products = await prisma.product.findMany({
      where: {
        firmId: requireFirmId(user),
        status: "ACTIVE",
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { subName: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { modelNumber: { contains: q, mode: "insensitive" } },
                { partNumber: { contains: q, mode: "insensitive" } },
                { barcode: q },
              ],
            }
          : {}),
      },
      select: { id: true, sku: true, name: true },
      orderBy: { name: "asc" },
      take: 40,
    });
    return products;
  });
}

export async function searchSuppliersAction(query: string) {
  return runAction(async () => {
    const user = await authorize("invoice_import.manage");
    const q = query.trim();
    return prisma.supplier.findMany({
      where: {
        firmId: requireFirmId(user),
        isActive: true,
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { gstin: { contains: q, mode: "insensitive" } }] } : {}),
      },
      select: { id: true, name: true, gstin: true },
      orderBy: { name: "asc" },
      take: 40,
    });
  });
}
