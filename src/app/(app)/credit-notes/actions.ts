"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { cancelCreditDebitNote, createCreditDebitNote, createCreditNoteFromSalesReturn, type NoteInput } from "@/lib/services/credit-notes";

export async function searchInvoicesForNoteAction(query: string) {
  return runAction(async () => {
    const user = await authorize("invoice.view");
    const q = query.trim();
    const rows = await prisma.invoice.findMany({
      where: { firmId: requireFirmId(user), kind: "TAX_INVOICE", status: { not: "CANCELLED" }, ...(q ? { OR: [{ invoiceNumber: { contains: q, mode: "insensitive" } }, { billToName: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: { invoiceDate: "desc" }, take: 20,
      select: { id: true, invoiceNumber: true, invoiceDate: true, billToName: true, totalAmount: true, customerId: true },
    });
    return rows.map((r) => ({ id: r.id, number: r.invoiceNumber, date: r.invoiceDate.toISOString().slice(0, 10), customer: r.billToName, total: Number(r.totalAmount), customerId: r.customerId }));
  });
}

/** An invoice's lines with how much of each can still be credited. */
export async function invoiceLinesForNoteAction(invoiceId: string) {
  return runAction(async () => {
    const user = await authorize("invoice.view");
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, firmId: requireFirmId(user) },
      include: { lines: { orderBy: { id: "asc" } } },
    });
    if (!invoice) throw new Error("Invoice not found");
    const credited = await prisma.creditDebitNoteLine.groupBy({
      by: ["invoiceLineId"], _sum: { quantity: true },
      where: { invoiceLineId: { in: invoice.lines.map((l) => l.id) }, note: { noteType: "CREDIT", status: "ISSUED" } },
    });
    const used = new Map(credited.map((c) => [c.invoiceLineId, c._sum.quantity ?? 0]));
    return {
      invoice: { id: invoice.id, number: invoice.invoiceNumber, customerId: invoice.customerId, placeOfSupplyCode: invoice.placeOfSupplyCode, placeOfSupply: invoice.placeOfSupply, date: invoice.invoiceDate.toISOString().slice(0, 10) },
      lines: invoice.lines.map((l) => ({ id: l.id, description: l.description, hsn: l.hsnCode, quantity: l.quantity, remaining: l.quantity - (used.get(l.id) ?? 0), taxable: Number(l.taxableValue), rate: Number(l.gstRate) })),
    };
  });
}

type CreateInput = Omit<NoteInput, "firmId" | "branchId" | "userId" | "noteDate"> & { noteDate?: string };

export async function createNoteAction(input: CreateInput) {
  return runAction(async () => {
    const user = await authorize("invoice.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);
    const note = await createCreditDebitNote({
      ...input, firmId, branchId, userId: user.id,
      noteDate: input.noteDate ? new Date(`${input.noteDate}T12:00:00+05:30`) : undefined,
      originalInvoiceDate: input.originalInvoiceDate ? new Date(input.originalInvoiceDate as unknown as string) : null,
    });
    revalidatePath("/credit-notes");
    return { id: note.id, number: note.noteNumber };
  });
}

export async function createFromReturnAction(salesReturnId: string) {
  return runAction(async () => {
    const user = await authorize("invoice.create");
    const note = await createCreditNoteFromSalesReturn({ firmId: requireFirmId(user), branchId: await requireWriteBranch(user, null), salesReturnId, userId: user.id });
    revalidatePath("/credit-notes");
    revalidatePath(`/sales-returns/${salesReturnId}`);
    return { id: note.id, number: note.noteNumber };
  });
}

export async function cancelNoteAction(noteId: string, reason: string) {
  return runAction(async () => {
    const user = await authorize("invoice.cancel");
    await cancelCreditDebitNote({ firmId: requireFirmId(user), noteId, reason, userId: user.id });
    revalidatePath("/credit-notes");
    revalidatePath(`/credit-notes/${noteId}`);
  });
}
