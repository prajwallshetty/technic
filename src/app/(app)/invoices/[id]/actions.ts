"use server";

import { revalidatePath } from "next/cache";

import { runAction, NotFoundError } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch, taxModeWhere } from "@/lib/session";
import { recordCustomerPayment, createSalesReturn } from "@/lib/services/payments";
import { cancelInvoice, updateInvoice, deleteInvoice } from "@/lib/services/sales";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export async function cancelInvoiceAction(input: { invoiceId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.INVOICE_CANCEL, PERMISSIONS.SALES_CANCEL]);
    if (!user.activeFirmId) throw new Error("Select a firm first");
    // View isolation: a GST_ONLY session may only touch GST invoices.
    const visible = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId: user.activeFirmId, ...taxModeWhere(user) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundError("Invoice not found");
    await cancelInvoice(user.activeFirmId, input.invoiceId, input.reason.trim(), user.id);
    return { cancelled: true };
  });
}

export async function recordInvoicePaymentAction(input: {
  invoiceId: string;
  amount: number;
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
}) {
  return runAction(async () => {
    const user = await authorize("payments.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId, ...taxModeWhere(user) },
      select: { customerId: true },
    });
    if (!invoice) {
      const { NotFoundError } = await import("@/lib/action-result");
      throw new NotFoundError("Invoice not found");
    }

    const payment = await recordCustomerPayment({
      firmId,
      branchId,
      customerId: invoice.customerId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      userId: user.id,
    });

    revalidatePath(`/invoices/${input.invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath("/payments");
    revalidatePath("/customers");
    return { paymentNumber: payment.paymentNumber };
  });
}

export async function createSalesReturnAction(input: {
  invoiceId: string;
  reason: string;
  refundMethod: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  lines: { invoiceLineId: string; quantity: number; serialNumbers?: string[] }[];
}) {
  return runAction(async () => {
    const user = await authorize("sales_return.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    // View isolation: returns can only be raised against invoices in view.
    const visible = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId, ...taxModeWhere(user) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundError("Invoice not found");

    const returnDoc = await createSalesReturn({
      firmId,
      branchId,
      invoiceId: input.invoiceId,
      reason: input.reason.trim(),
      refundMethod: input.refundMethod,
      lines: input.lines,
      userId: user.id,
    });

    revalidatePath(`/invoices/${input.invoiceId}`);
    revalidatePath("/sales-returns");
    return { returnNumber: returnDoc.returnNumber };
  });
}

export async function updateInvoiceDispatchAction(input: {
  invoiceId: string;
  dispatchThrough?: string | null;
  vehicleNumber?: string | null;
  ewayBillNumber?: string | null;
  buyerOrderNo?: string | null;
}) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.INVOICE_CREATE, PERMISSIONS.INVOICE_EDIT, PERMISSIONS.SALES_EDIT]);
    const firmId = requireFirmId(user);
    const visible = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId, ...taxModeWhere(user) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundError("Invoice not found");
    const clean = (value?: string | null) => value?.trim() || null;
    await prisma.invoice.update({
      where: { id: visible.id },
      data: {
        dispatchThrough: clean(input.dispatchThrough),
        vehicleNumber: clean(input.vehicleNumber)?.toUpperCase() ?? null,
        ewayBillNumber: clean(input.ewayBillNumber),
        buyerOrderNo: clean(input.buyerOrderNo),
      },
    });
    revalidatePath(`/invoices/${input.invoiceId}`);
    return { saved: true };
  });
}

export async function updateInvoiceAction(input: {
  invoiceId: string;
  customerId?: string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  billToName?: string;
  billToPhone?: string | null;
  billToEmail?: string | null;
  billToAddress?: string | null;
  billToGstin?: string | null;
  placeOfSupply?: string | null;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  dispatchThrough?: string | null;
  vehicleNumber?: string | null;
  ewayBillNumber?: string | null;
  buyerOrderNo?: string | null;
  lines?: {
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
      PERMISSIONS.INVOICE_EDIT,
      PERMISSIONS.INVOICE_CREATE,
      PERMISSIONS.SALES_EDIT,
    ]);
    const firmId = requireFirmId(user);

    const visible = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId, ...taxModeWhere(user) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundError("Invoice not found");

    if (input.lines && input.lines.length === 0) {
      throw new Error("Add at least one item to the invoice");
    }

    const clean = (value?: string | null) => (value !== undefined ? value?.trim() || null : undefined);

    const invoice = await updateInvoice({
      firmId,
      invoiceId: input.invoiceId,
      customerId: input.customerId,
      invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : undefined,
      dueDate: input.dueDate ? new Date(input.dueDate) : input.dueDate === "" ? null : undefined,
      billToName: input.billToName?.trim(),
      billToPhone: clean(input.billToPhone),
      billToEmail: clean(input.billToEmail),
      billToAddress: clean(input.billToAddress),
      billToGstin: clean(input.billToGstin),
      placeOfSupply: clean(input.placeOfSupply),
      notes: clean(input.notes),
      terms: clean(input.terms),
      discountRemarks: clean(input.discountRemarks),
      dispatchThrough: clean(input.dispatchThrough),
      vehicleNumber: input.vehicleNumber !== undefined ? clean(input.vehicleNumber)?.toUpperCase() ?? null : undefined,
      ewayBillNumber: clean(input.ewayBillNumber),
      buyerOrderNo: clean(input.buyerOrderNo),
      lines: input.lines,
      userId: user.id,
      manualRoundOff: input.manualRoundOff,
    });

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoice.id}`);
    revalidatePath("/customers");
    revalidatePath("/inventory");
    return {
      invoiceNumber: invoice.invoiceNumber,
      id: invoice.id,
    };
  });
}

export async function deleteInvoiceAction(input: { invoiceId: string }) {
  return runAction(async () => {
    const user = await authorize([
      PERMISSIONS.INVOICE_DELETE,
      PERMISSIONS.INVOICE_EDIT,
      PERMISSIONS.SALES_EDIT,
    ]);
    if (!user.activeFirmId) throw new Error("Select a firm first");

    const visible = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId: user.activeFirmId, ...taxModeWhere(user) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundError("Invoice not found");

    await deleteInvoice(user.activeFirmId, input.invoiceId, user.id);

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${input.invoiceId}`);
    revalidatePath("/customers");
    revalidatePath("/inventory");
    return { success: true };
  });
}

