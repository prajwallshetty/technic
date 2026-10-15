import "server-only";

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { nextDocumentNumber, DOCUMENT_TYPES } from "@/lib/sequence";
import { recordAudit } from "@/lib/audit";
import { round2 } from "@/lib/money";
import { recalcCustomerRollup } from "@/lib/services/sales";
import { recalcSupplierRollup } from "@/lib/services/purchases";
import { writeStockTransaction } from "@/lib/services/inventory";

/**
 * Payment service — customer receipts (incl. advances), supplier payments and
 * refunds land in one ledger; outstanding balances are always re-derived from
 * invoices − payments − credits, never trusted from a stored increment.
 */

export async function recordCustomerPayment(input: {
  firmId: string;
  branchId: string;
  customerId: string;
  invoiceId?: string | null;
  amount: number;
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  reference?: string | null;
  notes?: string | null;
  userId?: string | null;
}) {
  if (input.amount <= 0) throw new BusinessRuleError("Payment amount must be greater than zero");

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, firmId: input.firmId },
  });
  if (!customer) throw new NotFoundError("Customer not found");

  if (input.invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, firmId: input.firmId, customerId: input.customerId },
    });
    if (!invoice) throw new NotFoundError("Invoice not found for this customer");
    if (invoice.status === "CANCELLED") {
      throw new BusinessRuleError("Cannot pay a cancelled invoice");
    }
    if (input.amount > Number(invoice.amountDue) + 0.001) {
      throw new BusinessRuleError(
        `Amount exceeds the invoice balance of ${Number(invoice.amountDue).toFixed(2)}`,
      );
    }
  }

  const paymentNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.PAYMENT, "NON_GST");

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        paymentNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        direction: "CUSTOMER_IN",
        status: "PAID",
        customerId: input.customerId,
        invoiceId: input.invoiceId ?? null,
        amount: round2(input.amount),
        method: input.method,
        isAdvance: !input.invoiceId,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        receivedById: input.userId ?? null,
      },
    });

    if (input.invoiceId) {
      const invoice = await tx.invoice.findUnique({
        where: { id: input.invoiceId },
        select: { totalAmount: true, amountPaid: true },
      });
      if (invoice) {
        const paid = round2(Number(invoice.amountPaid) + input.amount);
        await tx.invoice.update({
          where: { id: input.invoiceId },
          data: {
            amountPaid: paid,
            amountDue: round2(Math.max(0, Number(invoice.totalAmount) - paid)),
            status: paid >= Number(invoice.totalAmount) - 0.001 ? "PAID" : "PARTIALLY_PAID",
          },
        });
      }
    }

    await recalcCustomerRollup(tx as never, input.firmId, input.customerId);

    await recordAudit({
      action: "PAYMENT_CREATED",
      entity: "Payment",
      entityId: payment.id,
      summary: `${paymentNumber} · ${input.method}`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
      after: { amount: input.amount, invoiceId: input.invoiceId ?? null },
    });

    return payment;
  });
}

export async function recordSupplierPayment(input: {
  firmId: string;
  branchId: string;
  supplierId: string;
  invoiceId?: string | null;
  amount: number;
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  reference?: string | null;
  notes?: string | null;
  userId?: string | null;
}) {
  if (input.amount <= 0) throw new BusinessRuleError("Payment amount must be greater than zero");
  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, firmId: input.firmId },
  });
  if (!supplier) throw new NotFoundError("Supplier not found");

  if (input.invoiceId) {
    const invoice = await prisma.purchaseInvoice.findFirst({
      where: { id: input.invoiceId, firmId: input.firmId, supplierId: input.supplierId },
    });
    if (!invoice) throw new NotFoundError("Purchase invoice not found for this supplier");
    const due = Number(invoice.total) - Number(invoice.amountPaid);
    if (input.amount > due + 0.001) {
      throw new BusinessRuleError(`Amount exceeds the bill balance of ${due.toFixed(2)}`);
    }
  }

  const paymentNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.PAYMENT, "NON_GST");

  return prisma.$transaction(async (tx) => {
    const payment = await tx.supplierPayment.create({
      data: {
        paymentNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        supplierId: input.supplierId,
        invoiceId: input.invoiceId ?? null,
        amount: round2(input.amount),
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        paidById: input.userId ?? null,
      },
    });

    if (input.invoiceId) {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id: input.invoiceId },
        select: { total: true, amountPaid: true },
      });
      if (invoice) {
        const paid = round2(Number(invoice.amountPaid) + input.amount);
        await tx.purchaseInvoice.update({
          where: { id: input.invoiceId },
          data: {
            amountPaid: paid,
            status: paid >= Number(invoice.total) - 0.001 ? "PAID" : "PARTIALLY_PAID",
          },
        });
      }
    }

    await recalcSupplierRollup(tx as never, input.firmId, input.supplierId);

    await recordAudit({
      action: "PAYMENT_CREATED",
      entity: "SupplierPayment",
      entityId: payment.id,
      summary: `${paymentNumber} · ${input.method}`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
    });

    return payment;
  });
}

/** Sales return: stock comes back, serials are re-validated, customer credited. */
export async function createSalesReturn(input: {
  firmId: string;
  branchId: string;
  invoiceId: string;
  reason: string;
  refundMethod: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  lines: { invoiceLineId: string; quantity: number; serialNumbers?: string[] }[];
  userId?: string | null;
}) {
  if (!input.reason.trim()) throw new BusinessRuleError("A return reason is required");
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, firmId: input.firmId },
    include: { lines: true },
  });
  if (!invoice) throw new NotFoundError("Invoice not found");
  if (invoice.status === "CANCELLED") throw new BusinessRuleError("Cannot return against a cancelled invoice");

  const returnNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.SALES_RETURN, "NON_GST");

  let total = 0;
  const prepared: {
    line: (typeof invoice.lines)[number];
    quantity: number;
    serials: string[];
  }[] = [];

  for (const inputLine of input.lines) {
    const line = invoice.lines.find((candidate) => candidate.id === inputLine.invoiceLineId);
    if (!line) throw new NotFoundError("Invoice line not found");
    const returnable = line.quantity - line.returnedQty;
    if (inputLine.quantity <= 0 || inputLine.quantity > returnable) {
      throw new BusinessRuleError(
        `Only ${returnable} of "${line.description}" can still be returned`,
      );
    }
    const serials = (inputLine.serialNumbers ?? []).map((s) => s.trim()).filter(Boolean);
    if (line.serialNumbers) {
      // Serialized items must return the exact serials sold.
      if (serials.length !== inputLine.quantity) {
        throw new BusinessRuleError(
          `"${line.description}" requires ${inputLine.quantity} serial number${inputLine.quantity === 1 ? "" : "s"}`,
        );
      }
      const soldSerials = line.serialNumbers.split("\n").filter(Boolean);
      for (const serial of serials) {
        if (!soldSerials.includes(serial)) {
          throw new BusinessRuleError(`Serial ${serial} was not sold on this invoice`);
        }
      }
    }
    total += Number(line.unitPrice) * inputLine.quantity * (1 - Number(line.discountPercent) / 100);
    prepared.push({ line, quantity: inputLine.quantity, serials });
  }

  return prisma.$transaction(async (tx) => {
    const salesReturn = await tx.salesReturn.create({
      data: {
        returnNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        taxMode: invoice.taxMode,
        reason: input.reason,
        refundMethod: input.refundMethod,
        totalAmount: round2(total),
        createdById: input.userId ?? null,
        lines: {
          create: prepared.map(({ line, quantity, serials }) => ({
            productId: line.productId,
            variantId: line.variantId,
            invoiceLineId: line.id,
            description: line.description,
            serialNumbers: serials.length > 0 ? serials.join("\n") : null,
            quantity,
            unitPrice: line.unitPrice,
            gstRate: line.gstRate,
            lineTotal: round2(Number(line.unitPrice) * quantity * (1 - Number(line.discountPercent) / 100)),
          })),
        },
      },
    });

    for (const { line, quantity, serials } of prepared) {
      await tx.invoiceLine.update({
        where: { id: line.id },
        data: { returnedQty: { increment: quantity } },
      });

      // Stock returns only when the return is approved.
      if (line.serialNumbers && serials.length > 0) {
        const units = await tx.serialUnit.findMany({
          where: { firmId: input.firmId, serialNumber: { in: serials } },
          select: { id: true },
        });
        for (const unit of units) {
          await tx.serialUnit.update({
            where: { id: unit.id },
            data: { status: "RETURNED", soldInvoiceId: null, soldInvoiceLineId: null },
          });
          await tx.serialHistory.create({
            data: {
              serialUnitId: unit.id,
              eventType: "SALE_RETURNED",
              fromStatus: "SOLD",
              toStatus: "RETURNED",
              reference: returnNumber,
              documentId: salesReturn.id,
              userId: input.userId ?? null,
            },
          });
        }
      }
    }

    await recalcCustomerRollup(tx as never, input.firmId, invoice.customerId);

    await recordAudit({
      action: "SALE_RETURNED",
      entity: "SalesReturn",
      entityId: salesReturn.id,
      summary: `${returnNumber} against ${invoice.invoiceNumber}`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
    });

    return salesReturn;
  });
}

/** Approving a sales return puts the stock back and refunds the customer. */
export async function approveSalesReturn(
  firmId: string,
  salesReturnId: string,
  userId?: string | null,
) {
  const salesReturn = await prisma.salesReturn.findFirst({
    where: { id: salesReturnId, firmId },
    include: { lines: true, invoice: true },
  });
  if (!salesReturn) throw new NotFoundError("Sales return not found");
  if (salesReturn.status !== "PENDING") {
    throw new BusinessRuleError("This return has already been processed");
  }

  return prisma.$transaction(async (tx) => {
    for (const line of salesReturn.lines) {
      await writeStockTransaction(tx, {
        firmId,
        branchId: salesReturn.branchId,
        productId: line.productId,
        variantId: line.variantId,
        type: "SALE_RETURN_IN",
        quantity: line.quantity,
        unitCost: Number(line.unitPrice),
        reference: salesReturn.returnNumber,
        documentType: "SALES_RETURN",
        documentId: salesReturn.id,
        userId: userId ?? null,
      });
      // Returned serials go back to sellable stock at this branch.
      if (line.serialNumbers) {
        const serials = line.serialNumbers.split("\n").filter(Boolean);
        await tx.serialUnit.updateMany({
          where: { firmId, serialNumber: { in: serials } },
          data: { status: "IN_STOCK", branchId: salesReturn.branchId },
        });
      }
    }

    const refundNumber = await nextDocumentNumber(firmId, DOCUMENT_TYPES.PAYMENT, "NON_GST", tx);
    await tx.payment.create({
      data: {
        paymentNumber: refundNumber,
        firmId,
        branchId: salesReturn.branchId,
        direction: "REFUND_OUT",
        status: "PAID",
        customerId: salesReturn.customerId,
        invoiceId: salesReturn.invoiceId,
        salesReturnId: salesReturn.id,
        amount: salesReturn.totalAmount,
        method: salesReturn.refundMethod,
        notes: `Refund for ${salesReturn.returnNumber}`,
        receivedById: userId ?? null,
      },
    });

    const updated = await tx.salesReturn.update({
      where: { id: salesReturn.id },
      data: { status: "APPROVED", approvedById: userId ?? null, approvedAt: new Date() },
    });

    // Reduce the invoice's paid amount by the refund (credit to customer).
    const invoice = await tx.invoice.findUnique({
      where: { id: salesReturn.invoiceId },
      select: { amountPaid: true, totalAmount: true, customerId: true, status: true },
    });
    if (invoice) {
      const paid = round2(Math.max(0, Number(invoice.amountPaid) - Number(salesReturn.totalAmount)));
      await tx.invoice.update({
        where: { id: salesReturn.invoiceId },
        data: {
          amountPaid: paid,
          amountDue: round2(Math.max(0, Number(invoice.totalAmount) - paid)),
          status:
            paid >= Number(invoice.totalAmount) - 0.001
              ? "PAID"
              : paid > 0
                ? "PARTIALLY_PAID"
                : "ISSUED",
        },
      });
      await recalcCustomerRollup(tx as never, firmId, invoice.customerId);
    }

    await recordAudit({
      action: "SALE_RETURNED",
      entity: "SalesReturn",
      entityId: salesReturn.id,
      summary: `${salesReturn.returnNumber} approved · stock restored`,
      firmId,
      userId,
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export async function createExpense(input: {
  firmId: string;
  branchId: string;
  category:
    | "RENT"
    | "ELECTRICITY"
    | "INTERNET"
    | "SALARY"
    | "TRANSPORT"
    | "OFFICE"
    | "MARKETING"
    | "MAINTENANCE"
    | "OTHER";
  amount: number;
  description: string;
  paidTo?: string | null;
  paymentMethod: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
  expenseDate?: Date;
  attachmentUrl?: string | null;
  userId?: string | null;
}) {
  if (input.amount <= 0) throw new BusinessRuleError("Expense amount must be greater than zero");
  if (!input.description.trim()) throw new BusinessRuleError("A description is required");

  const expenseNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.EXPENSE, "NON_GST");

  const expense = await prisma.expense.create({
    data: {
      expenseNumber,
      firmId: input.firmId,
      branchId: input.branchId,
      category: input.category,
      amount: round2(input.amount),
      description: input.description.trim(),
      paidTo: input.paidTo?.trim() || null,
      paymentMethod: input.paymentMethod,
      expenseDate: input.expenseDate ?? new Date(),
      attachmentUrl: input.attachmentUrl ?? null,
      createdById: input.userId ?? null,
    },
  });

  await recordAudit({
    action: "EXPENSE_CREATED",
    entity: "Expense",
    entityId: expense.id,
    summary: `${expenseNumber} · ${input.category}`,
    firmId: input.firmId,
    branchId: input.branchId,
    userId: input.userId,
  });

  return expense;
}

export async function approveExpense(
  firmId: string,
  expenseId: string,
  decision: "APPROVED" | "REJECTED" | "PAID",
  userId?: string | null,
) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, firmId } });
  if (!expense) throw new NotFoundError("Expense not found");
  return prisma.expense.update({
    where: { id: expenseId },
    data: {
      status: decision,
      approvedById: userId ?? null,
      approvedAt: new Date(),
    },
  });
}

export async function getPaymentForView(
  firmId: string,
  paymentId: string,
  options: { taxMode?: "GST" | "NON_GST" } = {},
) {
  const whereClause: any = { id: paymentId, firmId };
  
  if (options.taxMode) {
    whereClause.OR = [
      { invoice: { taxMode: options.taxMode } },
      { purchaseInvoice: { taxMode: options.taxMode } },
      { isAdvance: true },
      { salesReturn: { invoice: { taxMode: options.taxMode } } },
    ];
  }

  const payment = await prisma.payment.findFirst({
    where: whereClause,
    include: {
      customer: true,
      invoice: {
        include: {
          customer: { select: { name: true } },
        },
      },
      branch: true,
      receivedBy: { select: { name: true } },
      salesReturn: {
        include: {
          invoice: { select: { invoiceNumber: true } },
        },
      },
    },
  });
  if (!payment) throw new NotFoundError("Payment not found");
  return payment;
}

export async function getSalesReturnForView(
  firmId: string,
  returnId: string,
  options: { taxMode?: "GST" | "NON_GST" } = {},
) {
  const salesReturn = await prisma.salesReturn.findFirst({
    where: { 
      id: returnId, 
      firmId,
      invoice: options.taxMode ? { taxMode: options.taxMode } : {},
    },
    include: {
      customer: true,
      invoice: {
        include: {
          customer: { select: { name: true } },
        },
      },
      branch: true,
      lines: {
        include: {
          product: { select: { name: true, sku: true } },
          variant: { select: { name: true, sku: true } },
        },
      },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });
  if (!salesReturn) throw new NotFoundError("Sales return not found");
  return salesReturn;
}
