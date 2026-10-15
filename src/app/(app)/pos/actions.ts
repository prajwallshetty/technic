"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError, AccessModeError } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { canBillGst } from "@/lib/access-mode";
import { createInvoice, type SaleLineInput } from "@/lib/services/sales";

export interface CheckoutInput {
  customerId: string;
  lines: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    gstRate?: number;
    serialNumbers?: string[];
  }[];
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  notes?: string;
  discountRemarks?: string;
  /** Requested tax treatment. Only users with GST billing permission may
   *  request "GST"; everyone else is always billed non-GST. */
  taxMode?: "GST" | "NON_GST";
  manualRoundOff?: number | null;
}

/**
 * Billing gate. The client may request the tax treatment, but it is only
 * honoured when the server confirms the user holds the GST billing permission
 * (gst_reports.view) — never trusted on its own.
 */
export async function checkoutAction(input: CheckoutInput) {
  return runAction(async () => {
    const user = await authorize("invoice.create");
    const firmId = requireFirmId(user);
    // Resolve the work location through the same validated path as every
    // other write — a stale session branch must never reach the ledger.
    const branchId = await requireWriteBranch(user);
    const requested = input.taxMode === "GST";
    if (requested && !canBillGst(user)) {
      throw new AccessModeError("GST billing requires the GST reporting permission.");
    }
    const mode = requested ? "GST" : "NON_GST";

    if (input.lines.length === 0) {
      throw new BusinessRuleError("Add at least one item before checkout");
    }

    const invoice = await createInvoice({
      firmId,
      branchId,
      customerId: input.customerId,
      taxMode: mode,
      lines: input.lines as SaleLineInput[],
      paymentAmount: input.paymentAmount && input.paymentAmount > 0 ? input.paymentAmount : undefined,
      paymentMethod: input.paymentMethod,
      notes: input.notes ?? null,
      discountRemarks: input.discountRemarks?.trim() || null,
      userId: user.id,
      manualRoundOff: input.manualRoundOff,
    });

    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
  });
}
