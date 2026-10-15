"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { createQuotation, updateQuotation, deleteQuotation } from "@/lib/services/sales";
import { PERMISSIONS } from "@/lib/rbac";

export async function createQuotationAction(input: {
  customerId: string;
  taxMode: "GST" | "NON_GST";
  validUntil?: string | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  lines: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    gstRate?: number;
    serialNumbers?: string[];
  }[];
  manualRoundOff?: number | null;
}) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.QUOTATION_CREATE, PERMISSIONS.SALES_CREATE]);
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    if (!input.lines?.length) {
      throw new Error("Add at least one item to the quotation");
    }

    const quotation = await createQuotation({
      firmId,
      branchId,
      customerId: input.customerId,
      taxMode: input.taxMode,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      discountRemarks: input.discountRemarks?.trim() || null,
      lines: input.lines,
      userId: user.id,
      manualRoundOff: input.manualRoundOff,
    });

    revalidatePath("/quotations");
    return {
      quotationNumber: quotation.quotationNumber,
      id: quotation.id,
    };
  });
}

export async function updateQuotationAction(input: {
  quotationId: string;
  customerId: string;
  taxMode: "GST" | "NON_GST";
  quotationDate?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  lines: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    gstRate?: number;
    serialNumbers?: string[];
  }[];
  manualRoundOff?: number | null;
}) {
  return runAction(async () => {
    const user = await authorize([
      PERMISSIONS.QUOTATION_EDIT,
      PERMISSIONS.QUOTATION_CREATE,
      PERMISSIONS.SALES_EDIT,
    ]);
    const firmId = requireFirmId(user);

    if (!input.lines?.length) {
      throw new Error("Add at least one item to the quotation");
    }

    const quotation = await updateQuotation({
      firmId,
      quotationId: input.quotationId,
      customerId: input.customerId,
      taxMode: input.taxMode,
      quotationDate: input.quotationDate ? new Date(input.quotationDate) : undefined,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      notes: input.notes !== undefined ? input.notes?.trim() || null : undefined,
      terms: input.terms !== undefined ? input.terms?.trim() || null : undefined,
      discountRemarks: input.discountRemarks !== undefined ? input.discountRemarks?.trim() || null : undefined,
      status: input.status,
      lines: input.lines,
      userId: user.id,
      manualRoundOff: input.manualRoundOff,
    });

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${quotation.id}`);
    return {
      quotationNumber: quotation.quotationNumber,
      id: quotation.id,
    };
  });
}

export async function deleteQuotationAction(input: { quotationId: string }) {
  return runAction(async () => {
    const user = await authorize([
      PERMISSIONS.QUOTATION_DELETE,
      PERMISSIONS.QUOTATION_EDIT,
      PERMISSIONS.SALES_EDIT,
    ]);
    const firmId = requireFirmId(user);

    await deleteQuotation(firmId, input.quotationId, user.id);

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${input.quotationId}`);
    return { success: true };
  });
}


