import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { FOREIGN_POS, STATES, normaliseUqc, stateCodeFromGstin, stateName } from "@/lib/gst/gstr1/masters";
import { round2 } from "@/lib/money";
import { DOCUMENT_TYPES, nextDocumentNumber } from "@/lib/sequence";
import { recalcCustomerRollup } from "@/lib/services/sales";

/**
 * Credit and debit notes (GST section 34).
 *
 * - A note is its own document with its own numbering series; an approved sales
 *   return can be turned into a credit note, but never automatically.
 * - Lines that refer to an invoice line mirror it proportionally (same HSN,
 *   rate and tax split), so the note always reconciles with its invoice.
 * - A note moves no stock — returned goods are received through the sales-return
 *   workflow. It does post a customer-ledger adjustment, in the same transaction,
 *   so the customer's balance stays right.
 * - GST note numbers may be at most 16 characters (portal rule), so the default
 *   series is short: "CN/26-27/1", "DN/26-27/1".
 */
export interface NoteLineInput {
  invoiceLineId?: string | null;
  productId?: string | null;
  description?: string;
  hsnCode?: string | null;
  uqc?: string | null;
  quantity: number;
  /** Ex-tax unit price. Required unless the line refers to an invoice line. */
  unitPrice?: number;
  gstRate?: number;
}

export interface NoteInput {
  firmId: string;
  branchId: string;
  noteType: "CREDIT" | "DEBIT";
  noteDate?: Date;
  customerId: string;
  originalInvoiceId?: string | null;
  /** For an invoice that is not in this ERP. */
  originalInvoiceNumber?: string | null;
  originalInvoiceDate?: Date | null;
  reason: "SALES_RETURN" | "POST_SALE_DISCOUNT" | "DEFICIENCY_IN_SERVICES" | "CORRECTION_IN_INVOICE" | "CHANGE_IN_POS" | "FINALIZATION_OF_PROVISIONAL_ASSESSMENT" | "OTHERS";
  reasonText?: string | null;
  salesReturnId?: string | null;
  placeOfSupplyCode?: string | null;
  lines: NoteLineInput[];
  notes?: string | null;
  userId?: string | null;
}

const DEFAULT_TEMPLATES = { CREDIT: "CN/{FY}/{N}", DEBIT: "DN/{FY}/{N}" } as const;

/** Seeds the short default numbering series once per firm; editable afterwards in settings. */
async function ensureNoteNumbering(firmId: string) {
  for (const [type, key, template] of [["CREDIT", "sequence_credit_note_gst", DEFAULT_TEMPLATES.CREDIT], ["DEBIT", "sequence_debit_note_gst", DEFAULT_TEMPLATES.DEBIT]] as const) {
    void type;
    await prisma.setting.upsert({ where: { firmId_key: { firmId, key } }, create: { firmId, key, value: template, category: "documents" }, update: {} });
  }
}

export async function createCreditDebitNote(input: NoteInput) {
  if (input.lines.length === 0) throw new BusinessRuleError("Add at least one line");
  if (input.lines.some((l) => !(l.quantity > 0))) throw new BusinessRuleError("Quantities must be greater than zero");
  const [firm, customer, original] = await Promise.all([
    prisma.firm.findUnique({ where: { id: input.firmId }, select: { gstin: true } }),
    prisma.customer.findFirst({ where: { id: input.customerId, firmId: input.firmId } }),
    input.originalInvoiceId ? prisma.invoice.findFirst({ where: { id: input.originalInvoiceId, firmId: input.firmId }, include: { lines: true } }) : null,
  ]);
  if (!customer) throw new NotFoundError("Customer not found");
  if (input.originalInvoiceId && !original) throw new NotFoundError("The invoice this note refers to was not found");
  if (original && original.customerId !== input.customerId) throw new BusinessRuleError("The invoice belongs to a different customer");
  if (original?.status === "CANCELLED") throw new BusinessRuleError("The invoice is cancelled");
  const noteDate = input.noteDate ?? new Date();
  if (original && noteDate < new Date(original.invoiceDate.getTime() - 86_400_000)) throw new BusinessRuleError("A note cannot be dated before its invoice");

  const supplierState = stateCodeFromGstin(firm?.gstin);
  const posCode = input.placeOfSupplyCode?.trim() || original?.placeOfSupplyCode || (original?.placeOfSupply ? stateCodeByName(original.placeOfSupply) : null);
  if (!posCode || (!STATES[posCode] && posCode !== FOREIGN_POS.code)) throw new BusinessRuleError("Place of supply is required (choose the state)");
  const interState = supplierState ? posCode !== supplierState : false;

  // Quantity already credited per invoice line, so a line is never over-credited.
  const alreadyCredited = new Map<string, number>();
  if (original) {
    const prior = await prisma.creditDebitNoteLine.groupBy({
      by: ["invoiceLineId"], _sum: { quantity: true },
      where: { invoiceLineId: { in: original.lines.map((l) => l.id) }, note: { noteType: "CREDIT", status: "ISSUED" } },
    });
    for (const p of prior) if (p.invoiceLineId) alreadyCredited.set(p.invoiceLineId, p._sum.quantity ?? 0);
  }

  const lines = input.lines.map((l, idx) => {
    if (l.invoiceLineId) {
      const src = original?.lines.find((x) => x.id === l.invoiceLineId);
      if (!src) throw new BusinessRuleError(`Line ${idx + 1}: not a line of the selected invoice`);
      if (input.noteType === "CREDIT") {
        const room = src.quantity - (alreadyCredited.get(src.id) ?? 0);
        if (l.quantity > room) throw new BusinessRuleError(`Line ${idx + 1}: only ${room} of "${src.description.slice(0, 30)}" can still be credited (invoiced ${src.quantity}, already credited ${src.quantity - room})`);
      }
      const ratio = l.quantity / src.quantity;
      const part = (v: Prisma.Decimal) => round2(Number(v) * ratio);
      const taxable = part(src.taxableValue), cgst = part(src.cgstAmount), sgst = part(src.sgstAmount), igst = part(src.igstAmount), cess = part(src.cessAmount);
      return { invoiceLineId: src.id, productId: src.productId, description: src.description, hsnCode: src.hsnCode, uqc: src.uqc, quantity: l.quantity, unitPrice: round2(taxable / l.quantity),
        gstRate: Number(src.gstRate), cessRate: Number(src.cessRate), taxability: src.taxability, taxable, cgst, sgst, igst, cess };
    }
    if (!l.description?.trim()) throw new BusinessRuleError(`Line ${idx + 1}: description is required`);
    if (l.unitPrice === undefined || !(l.unitPrice >= 0)) throw new BusinessRuleError(`Line ${idx + 1}: enter the ex-tax price`);
    if (l.gstRate === undefined) throw new BusinessRuleError(`Line ${idx + 1}: enter the GST rate`);
    const uqc = l.uqc ? normaliseUqc(l.uqc) : null;
    if (l.uqc && !uqc) throw new BusinessRuleError(`Line ${idx + 1}: "${l.uqc}" is not an official unit`);
    const taxable = round2(l.quantity * l.unitPrice);
    const tax = (taxable * l.gstRate) / 100;
    return { invoiceLineId: null, productId: l.productId ?? null, description: l.description.trim(), hsnCode: l.hsnCode?.trim() || null, uqc: uqc?.split("-")[0] ?? null, quantity: l.quantity,
      unitPrice: round2(l.unitPrice), gstRate: l.gstRate, cessRate: 0, taxability: "TAXABLE" as const, taxable,
      cgst: interState ? 0 : round2(tax / 2), sgst: interState ? 0 : round2(tax / 2), igst: interState ? round2(tax) : 0, cess: 0 };
  });

  const sum = (k: "taxable" | "cgst" | "sgst" | "igst" | "cess") => round2(lines.reduce((n, l) => n + l[k], 0));
  const taxable = sum("taxable"), cgst = sum("cgst"), sgst = sum("sgst"), igst = sum("igst"), cess = sum("cess");
  const before = round2(taxable + cgst + sgst + igst + cess);
  const total = Math.round(before);
  const roundOff = round2(total - before);

  if (input.salesReturnId) {
    const ret = await prisma.salesReturn.findFirst({ where: { id: input.salesReturnId, firmId: input.firmId }, include: { creditNote: { select: { id: true } } } });
    if (!ret) throw new NotFoundError("Sales return not found");
    if (ret.status !== "APPROVED") throw new BusinessRuleError("Only an approved sales return can generate a credit note");
    if (ret.creditNote) throw new BusinessRuleError("This sales return already has a credit note");
    if (input.noteType !== "CREDIT") throw new BusinessRuleError("A sales return generates a credit note");
  }

  await ensureNoteNumbering(input.firmId);
  const noteNumber = await nextDocumentNumber(input.firmId, input.noteType === "CREDIT" ? DOCUMENT_TYPES.CREDIT_NOTE : DOCUMENT_TYPES.DEBIT_NOTE, "GST", prisma, noteDate);
  if (noteNumber.length > 16) throw new BusinessRuleError(`Note number "${noteNumber}" is longer than the 16 characters the GST portal accepts — shorten the numbering template in settings`);

  return prisma.$transaction(async (tx) => {
    const note = await tx.creditDebitNote.create({
      data: {
        firmId: input.firmId, branchId: input.branchId, noteType: input.noteType, noteNumber, noteDate, status: "ISSUED",
        customerId: customer.id, billToName: original?.billToName ?? customer.name, billToGstin: original ? original.billToGstin : customer.gstin,
        originalInvoiceId: original?.id ?? null, originalInvoiceNumber: original?.invoiceNumber ?? input.originalInvoiceNumber ?? null,
        originalInvoiceDate: original?.invoiceDate ?? input.originalInvoiceDate ?? null,
        reason: input.reason, reasonText: input.reasonText?.trim() || null, salesReturnId: input.salesReturnId ?? null,
        placeOfSupply: stateName(posCode), placeOfSupplyCode: posCode, supplyType: original?.supplyType ?? "REGULAR", reverseCharge: original?.reverseCharge ?? false,
        subtotal: taxable, taxableAmount: taxable, cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst, cessAmount: cess, roundOff, totalAmount: total,
        notes: input.notes?.trim() || null, createdById: input.userId ?? null,
        lines: { create: lines.map((l) => ({
          invoiceLineId: l.invoiceLineId, productId: l.productId, description: l.description, hsnCode: l.hsnCode, uqc: l.uqc, quantity: l.quantity, unitPrice: l.unitPrice,
          gstRate: l.gstRate, cessRate: l.cessRate, taxability: l.taxability, taxableValue: l.taxable, cgstAmount: l.cgst, sgstAmount: l.sgst, igstAmount: l.igst, cessAmount: l.cess,
          lineTotal: round2(l.taxable + l.cgst + l.sgst + l.igst + l.cess),
        })) },
      },
    });
    // Customer ledger: a credit note reduces what the customer owes, a debit note increases it.
    await tx.journalEntry.create({
      data: {
        entryNumber: `GST-${input.noteType === "CREDIT" ? "CN" : "DN"}-${noteNumber}`, firmId: input.firmId, type: input.noteType === "CREDIT" ? "CREDIT_ADJUSTMENT" : "DEBIT_ADJUSTMENT",
        customerId: customer.id, amount: total, entryDate: noteDate, reference: note.id,
        narration: `GST ${input.noteType === "CREDIT" ? "credit" : "debit"} note ${noteNumber}${note.originalInvoiceNumber ? ` against invoice ${note.originalInvoiceNumber}` : ""}`, createdById: input.userId ?? null,
      },
    });
    await recalcCustomerRollup(tx as never, input.firmId, customer.id);
    return note;
  }).then(async (note) => {
    await recordAudit({
      action: input.noteType === "CREDIT" ? "CREDIT_NOTE_CREATED" : "DEBIT_NOTE_CREATED", entity: "CreditDebitNote", entityId: note.id,
      summary: `${noteNumber} for ${note.billToName}: ₹${total.toFixed(2)}`, firmId: input.firmId, branchId: input.branchId, userId: input.userId,
      after: { total, taxable, original: note.originalInvoiceNumber, reason: input.reason },
    });
    return note;
  });
}

/** Turns an approved sales return into a credit note against the same invoice. Explicit, never automatic. */
export async function createCreditNoteFromSalesReturn(args: { firmId: string; branchId: string; salesReturnId: string; userId?: string | null }) {
  const ret = await prisma.salesReturn.findFirst({ where: { id: args.salesReturnId, firmId: args.firmId }, include: { lines: true } });
  if (!ret) throw new NotFoundError("Sales return not found");
  if (ret.taxMode !== "GST") throw new BusinessRuleError("Only returns against GST invoices can generate a GST credit note");
  const missing = ret.lines.filter((l) => !l.invoiceLineId);
  if (missing.length) throw new BusinessRuleError("Every returned line must refer to an invoice line to generate a credit note");
  return createCreditDebitNote({
    firmId: args.firmId, branchId: args.branchId, noteType: "CREDIT", customerId: ret.customerId, originalInvoiceId: ret.invoiceId,
    reason: "SALES_RETURN", reasonText: `Sales return ${ret.returnNumber}: ${ret.reason}`, salesReturnId: ret.id,
    lines: ret.lines.map((l) => ({ invoiceLineId: l.invoiceLineId, quantity: l.quantity })), userId: args.userId,
  });
}

export async function cancelCreditDebitNote(args: { firmId: string; noteId: string; reason: string; userId?: string | null }) {
  if (args.reason.trim().length < 3) throw new BusinessRuleError("Give a reason for cancelling");
  const note = await prisma.creditDebitNote.findFirst({ where: { id: args.noteId, firmId: args.firmId } });
  if (!note) throw new NotFoundError("Note not found");
  if (note.status === "CANCELLED") throw new BusinessRuleError("This note is already cancelled");
  await prisma.$transaction(async (tx) => {
    await tx.creditDebitNote.update({ where: { id: note.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: args.reason.trim() } });
    // Reverse the ledger effect with an opposite adjustment (journal rows are append-only).
    await tx.journalEntry.create({
      data: {
        entryNumber: `GST-${note.noteType === "CREDIT" ? "CN" : "DN"}-${note.noteNumber}-X`, firmId: args.firmId, type: note.noteType === "CREDIT" ? "DEBIT_ADJUSTMENT" : "CREDIT_ADJUSTMENT",
        customerId: note.customerId, amount: note.totalAmount, entryDate: new Date(), reference: note.id,
        narration: `Cancellation of GST ${note.noteType === "CREDIT" ? "credit" : "debit"} note ${note.noteNumber}: ${args.reason.trim()}`, createdById: args.userId ?? null,
      },
    });
    await recalcCustomerRollup(tx as never, args.firmId, note.customerId);
  });
  await recordAudit({ action: "NOTE_CANCELLED", entity: "CreditDebitNote", entityId: note.id, summary: `${note.noteNumber} cancelled — ${args.reason.trim()}`, firmId: args.firmId, userId: args.userId, before: { status: note.status } });
}

function stateCodeByName(name: string) {
  for (const [code, n] of Object.entries(STATES)) if (n.toLowerCase() === name.trim().toLowerCase()) return code;
  return null;
}

export async function listNotes(firmId: string, take = 100) {
  return prisma.creditDebitNote.findMany({ where: { firmId }, orderBy: { noteDate: "desc" }, take, include: { customer: { select: { name: true } } } });
}

export async function getNote(firmId: string, id: string) {
  const note = await prisma.creditDebitNote.findFirst({ where: { id, firmId }, include: { lines: true, customer: { select: { name: true, gstin: true } }, originalInvoice: { select: { id: true, invoiceNumber: true } } } });
  if (!note) throw new NotFoundError("Note not found");
  return note;
}
