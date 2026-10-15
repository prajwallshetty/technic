import "server-only";

import { prisma } from "@/lib/prisma";
import type { TaxMode } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { computeTaxSummary, isSameState } from "@/lib/tax";
import { nextDocumentNumber, DOCUMENT_TYPES } from "@/lib/sequence";
import { recordAudit } from "@/lib/audit";
import {
  assertSerialsInStockForPurchaseReturn,
  findSerialUnits,
  getStockLevel,
  transitionSerialUnits,
  writeStockTransaction,
} from "@/lib/services/inventory";
import { round2 } from "@/lib/money";

/**
 * Purchase service: Purchase Order → Goods Received → Purchase Invoice →
 * Stock Updated → Supplier Payable, plus purchase returns. Serialized products
 * register their exact serials/IMEIs at goods-receipt time.
 */

export interface PurchaseLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  gstRate?: number;
  serialNumbers?: string[];
  descriptionOverride?: string;
}

interface PurchaseHeaderInput {
  firmId: string;
  branchId: string;
  supplierId: string;
  taxMode: TaxMode;
  notes?: string | null;
  userId?: string | null;
}

function validateLines(lines: PurchaseLineInput[]) {
  if (lines.length === 0) throw new BusinessRuleError("Add at least one line item");
  for (const line of lines) {
    if (line.quantity <= 0) throw new BusinessRuleError("Quantity must be greater than zero");
    if (line.unitPrice < 0) throw new BusinessRuleError("Price cannot be negative");
  }
}

async function computePurchaseSummary(
  lines: PurchaseLineInput[],
  mode: TaxMode,
  firmState: string | null,
) {
  // Purchases from out-of-state suppliers use IGST; same-state CGST+SGST.
  const summary = computeTaxSummary(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? 0,
      gstRate: mode === "GST" ? (line.gstRate ?? 0) : 0,
    })),
    { mode, sameState: isSameState(firmState, null) },
  );
  return summary;
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export async function createPurchaseOrder(input: PurchaseHeaderInput & { lines: PurchaseLineInput[]; expectedDate?: Date | null }) {
  validateLines(input.lines);
  const firm = await prisma.firm.findUnique({ where: { id: input.firmId }, select: { state: true } });
  const summary = await computePurchaseSummary(input.lines, input.taxMode, firm?.state ?? null);
  const poNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.PURCHASE_ORDER, input.taxMode);

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, include: { variants: true } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        supplierId: input.supplierId,
        taxMode: input.taxMode,
        status: "DRAFT",
        expectedDate: input.expectedDate ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        total: summary.totalAmount,
        notes: input.notes ?? null,
        createdById: input.userId ?? null,
        items: {
          create: input.lines.map((line, index) => {
            const product = productMap.get(line.productId);
            if (!product) throw new NotFoundError("Product not found");
            const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : null;
            return {
              productId: product.id,
              variantId: variant?.id ?? null,
              description: line.descriptionOverride ?? (variant ? `${product.name} — ${variant.name}` : product.name),
              hsnCode: product.hsnCode,
              quantity: line.quantity,
              unitPrice: round2(line.unitPrice),
              discountPercent: line.discountPercent ?? 0,
              gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
              lineTotal: summary.lines[index].lineTotal,
            };
          }),
        },
      },
    });

    await recordAudit({
      action: "PURCHASE_CREATED",
      entity: "PurchaseOrder",
      entityId: po.id,
      summary: poNumber,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
    });

    return po;
  });
}

export async function updatePurchaseOrderStatus(
  firmId: string,
  poId: string,
  status: "DRAFT" | "SENT" | "CANCELLED",
  userId?: string | null,
) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: poId, firmId } });
  if (!po) throw new NotFoundError("Purchase order not found");
  if (po.status === "RECEIVED") throw new BusinessRuleError("A received order cannot be changed");
  return prisma.purchaseOrder.update({ where: { id: poId }, data: { status } });
}

// ---------------------------------------------------------------------------
// Goods receipt + purchase invoice (stock enters here)
// ---------------------------------------------------------------------------

export interface ReceiveInput extends PurchaseHeaderInput {
  poId?: string | null;
  supplierRef?: string | null;
  invoiceDate?: Date;
  dueDate?: Date | null;
  lines: PurchaseLineInput[];
  /** Record a supplier payment for (part of) this bill immediately. */
  paymentAmount?: number;
  paymentMethod?: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
}

/**
 * Receives goods and books the supplier bill in one transaction: serial units
 * are registered for tracked products, stock transactions written, the PO
 * progress updated and the payable recorded.
 */
export async function receiveGoods(input: ReceiveInput) {
  validateLines(input.lines);
  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, firmId: input.firmId },
  });
  if (!supplier) throw new NotFoundError("Supplier not found");

  const firm = await prisma.firm.findUnique({ where: { id: input.firmId }, select: { state: true } });
  const summary = await computePurchaseSummary(input.lines, input.taxMode, firm?.state ?? null);

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, include: { variants: true } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Validate serial inputs up front: tracked products need exactly quantity
  // serials, and none may already exist in the system (serials are unique).
  for (const line of input.lines) {
    const product = productMap.get(line.productId);
    if (!product) throw new NotFoundError("Product not found");
    if (product.trackSerials) {
      const serials = (line.serialNumbers ?? []).map((s) => s.trim()).filter(Boolean);
      if (serials.length !== line.quantity) {
        throw new BusinessRuleError(
          `${product.name} requires ${line.quantity} serial number${line.quantity === 1 ? "" : "s"}`,
        );
      }
      const existing = await findSerialUnits(input.firmId, serials);
      if (existing.length > 0) {
        throw new BusinessRuleError(
          `Serial number already exists: ${existing.map((u) => u.serialNumber).join(", ")}`,
        );
      }
    }
  }

  const grnNumber = await nextDocumentNumber(input.firmId, "goods_receipt", "NON_GST");
  const piNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.PURCHASE_INVOICE, "NON_GST");

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.goodsReceipt.create({
      data: {
        grnNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        ...(input.poId ? { poId: input.poId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        receivedById: input.userId ?? null,
        items: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            quantity: line.quantity,
            unitPrice: round2(line.unitPrice),
            serialNumbers: (line.serialNumbers ?? []).filter(Boolean).join("\n") || null,
          })),
        },
      },
    });

    const purchaseInvoice = await tx.purchaseInvoice.create({
      data: {
        invoiceNumber: piNumber,
        ...(input.supplierRef ? { supplierRef: input.supplierRef } : {}),
        firmId: input.firmId,
        branchId: input.branchId,
        supplierId: input.supplierId,
        poId: input.poId ?? null,
        taxMode: input.taxMode,
        status: input.paymentAmount && input.paymentAmount >= summary.totalAmount ? "PAID" : "UNPAID",
        invoiceDate: input.invoiceDate ?? new Date(),
        dueDate: input.dueDate ?? null,
        subtotal: summary.subtotal,
        discountAmount: summary.discountAmount,
        taxableAmount: summary.taxableAmount,
        cgstAmount: summary.cgstAmount,
        sgstAmount: summary.sgstAmount,
        igstAmount: summary.igstAmount,
        total: summary.totalAmount,
        amountPaid: 0,
        createdById: input.userId ?? null,
        lines: {
          create: input.lines.map((line, index) => {
            const product = productMap.get(line.productId)!;
            return {
              productId: product.id,
              variantId: line.variantId ?? null,
              description:
                line.descriptionOverride ??
                (() => {
                  const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : null;
                  return variant ? `${product.name} — ${variant.name}` : product.name;
                })(),
              hsnCode: product.hsnCode,
              serialNumbers: (line.serialNumbers ?? []).filter(Boolean).join("\n") || null,
              quantity: line.quantity,
              unitPrice: round2(line.unitPrice),
              discountPercent: line.discountPercent ?? 0,
              gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
              lineTotal: summary.lines[index].lineTotal,
            };
          }),
        },
      },
      include: { lines: true },
    });

    // Stock + serial registration.
    for (const line of input.lines) {
      const product = productMap.get(line.productId)!;
      await writeStockTransaction(tx, {
        firmId: input.firmId,
        branchId: input.branchId,
        productId: product.id,
        variantId: line.variantId ?? null,
        type: "PURCHASE_IN",
        quantity: line.quantity,
        unitCost: round2(line.unitPrice),
        reference: piNumber,
        documentType: "PURCHASE_INVOICE",
        documentId: purchaseInvoice.id,
        userId: input.userId ?? null,
      });

      if (product.trackSerials) {
        const serials = (line.serialNumbers ?? []).filter(Boolean);
        for (const serial of serials) {
          const unit = await tx.serialUnit.create({
            data: {
              firmId: input.firmId,
              productId: product.id,
              variantId: line.variantId ?? null,
              serialNumber: serial,
              status: "IN_STOCK",
              branchId: input.branchId,
              purchaseInvoiceId: purchaseInvoice.id,
              purchasePrice: round2(line.unitPrice),
              sellingPrice: round2(Number(product.sellingPrice)),
              purchasedAt: input.invoiceDate ?? new Date(),
            },
          });
          await tx.serialHistory.create({
            data: {
              serialUnitId: unit.id,
              eventType: "PURCHASE_IN",
              fromStatus: null,
              toStatus: "IN_STOCK",
              reference: piNumber,
              documentId: purchaseInvoice.id,
              userId: input.userId ?? null,
            },
          });
        }
      }
    }

    // PO progress.
    if (input.poId) {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: input.poId },
        include: { items: true },
      });
      if (po) {
        for (const item of po.items) {
          const received = input.lines
            .filter((line) => line.productId === item.productId && (line.variantId ?? null) === (item.variantId ?? null))
            .reduce((sum, line) => sum + line.quantity, 0);
          if (received > 0) {
            await tx.purchaseOrderLine.update({
              where: { id: item.id },
              data: { receivedQuantity: { increment: received } },
            });
          }
        }
        const refreshed = await tx.purchaseOrder.findUnique({
          where: { id: input.poId },
          include: { items: true },
        });
        const fullyReceived = refreshed!.items.every((item) => item.receivedQuantity >= item.quantity);
        const partially = refreshed!.items.some((item) => item.receivedQuantity > 0);
        await tx.purchaseOrder.update({
          where: { id: input.poId },
          data: { status: fullyReceived ? "RECEIVED" : partially ? "PARTIALLY_RECEIVED" : po.status },
        });
      }
    }

    // Immediate supplier payment.
    if (input.paymentAmount && input.paymentAmount > 0) {
      const paymentNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.PAYMENT, "NON_GST", tx);
      const amount = Math.min(input.paymentAmount, summary.totalAmount);
      await tx.supplierPayment.create({
        data: {
          paymentNumber,
          firmId: input.firmId,
          branchId: input.branchId,
          supplierId: input.supplierId,
          invoiceId: purchaseInvoice.id,
          amount,
          method: input.paymentMethod ?? "BANK_TRANSFER",
          paidAt: new Date(),
          paidById: input.userId ?? null,
        },
      });
      await tx.purchaseInvoice.update({
        where: { id: purchaseInvoice.id },
        data: {
          amountPaid: amount,
          status: amount >= summary.totalAmount ? "PAID" : "PARTIALLY_PAID",
        },
      });
      await recalcSupplierRollup(tx, input.firmId, input.supplierId);
    } else {
      await recalcSupplierRollup(tx, input.firmId, input.supplierId);
    }

    await recordAudit({
      action: "PURCHASE_RECEIVED",
      entity: "PurchaseInvoice",
      entityId: purchaseInvoice.id,
      summary: `${piNumber} · GRN ${grnNumber}`,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
      after: { total: Number(purchaseInvoice.total) },
    });

    return { receipt, purchaseInvoice };
  });
}

/** Payable = the supplier-ledger closing balance (shared ledger engine). */
export async function recalcSupplierRollup(
  tx: { supplier: { findUnique: Function; update: Function } },
  firmId: string,
  supplierId: string,
): Promise<void> {
  const { supplierBalance } = await import("@/lib/services/ledger");
  const supplier = await tx.supplier.findUnique({
    where: { id: supplierId },
    include: { purchaseInvoices: { where: { firmId, status: { not: "CANCELLED" } }, select: { total: true } } },
  });
  if (!supplier) return;

  const totalPurchased = supplier.purchaseInvoices.reduce((sum: number, inv: { total: unknown }) => sum + Number(inv.total), 0);
  const balance = await supplierBalance(tx as never, firmId, supplierId);

  await tx.supplier.update({
    where: { id: supplierId },
    data: {
      purchaseCount: supplier.purchaseInvoices.length,
      totalPurchased: round2(totalPurchased),
      outstandingAmount: Math.max(0, balance),
    },
  });
}

// ---------------------------------------------------------------------------
// Purchase returns
// ---------------------------------------------------------------------------

export async function createPurchaseReturn(
  input: PurchaseHeaderInput & {
    purchaseInvoiceId?: string | null;
    lines: PurchaseLineInput[];
    reason: string;
  },
) {
  validateLines(input.lines);
  if (!input.reason.trim()) throw new BusinessRuleError("A return reason is required");

  const summary = await computePurchaseSummary(input.lines, input.taxMode, null);
  const returnNumber = await nextDocumentNumber(input.firmId, DOCUMENT_TYPES.PURCHASE_RETURN, "NON_GST");

  // Serialized products must return the exact serial number.
  for (const line of input.lines) {
    if (line.serialNumbers && line.serialNumbers.filter(Boolean).length > 0) {
      await assertSerialsInStockForPurchaseReturn(input.firmId, input.branchId, line.serialNumbers);
    }
  }

  return prisma.$transaction(async (tx) => {
    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        returnNumber,
        firmId: input.firmId,
        branchId: input.branchId,
        supplierId: input.supplierId,
        purchaseInvoiceId: input.purchaseInvoiceId ?? null,
        taxMode: input.taxMode,
        reason: input.reason,
        total: summary.totalAmount,
        createdById: input.userId ?? null,
        items: {
          create: input.lines.map((line, index) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            description: line.descriptionOverride ?? "Item",
            serialNumbers: (line.serialNumbers ?? []).filter(Boolean).join("\n") || null,
            quantity: line.quantity,
            unitPrice: round2(line.unitPrice),
            gstRate: input.taxMode === "GST" ? (line.gstRate ?? 0) : 0,
            lineTotal: summary.lines[index].lineTotal,
          })),
        },
      },
    });

    for (const line of input.lines) {
      await writeStockTransaction(tx, {
        firmId: input.firmId,
        branchId: input.branchId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        type: "PURCHASE_RETURN_OUT",
        quantity: -line.quantity,
        unitCost: round2(line.unitPrice),
        reference: returnNumber,
        documentType: "PURCHASE_RETURN",
        documentId: purchaseReturn.id,
        userId: input.userId ?? null,
      });

      if (line.serialNumbers && line.serialNumbers.filter(Boolean).length > 0) {
        const units = await tx.serialUnit.findMany({
          where: { firmId: input.firmId, serialNumber: { in: line.serialNumbers.filter(Boolean) } },
          select: { id: true },
        });
        await transitionSerialUnits(tx, {
          firmId: input.firmId,
          serialUnitIds: units.map((u) => u.id),
          eventType: "PURCHASE_RETURNED",
          toStatus: "RETURNED",
          reference: returnNumber,
          userId: input.userId ?? null,
        });
      }
    }

    await recalcSupplierRollup(tx, input.firmId, input.supplierId);

    await recordAudit({
      action: "PURCHASE_RETURNED",
      entity: "PurchaseReturn",
      entityId: purchaseReturn.id,
      summary: returnNumber,
      firmId: input.firmId,
      branchId: input.branchId,
      userId: input.userId,
    });

    return purchaseReturn;
  });
}

export async function getPurchaseInvoiceForView(firmId: string, invoiceId: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id: invoiceId, firmId },
    include: {
      supplier: true,
      branch: true,
      po: { select: { id: true, poNumber: true } },
      lines: {
        include: {
          product: { select: { name: true, sku: true, hsnCode: true } },
          variant: { select: { name: true } },
        },
      },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!invoice) throw new NotFoundError("Purchase invoice not found");
  return invoice;
}

export { getStockLevel };
