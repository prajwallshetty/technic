import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { TaxMode } from "@/generated/prisma/enums";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Atomically increments a named counter and returns the new value.
 * Uses a single INSERT .. ON CONFLICT DO UPDATE so that concurrent callers
 * can never receive the same number.
 */
export async function nextSequence(key: string, db: Db = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "sequences" ("key", "value", "updatedAt")
    VALUES (${key}, 1, NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "sequences"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1;
}

/**
 * Atomically increments a per-firm document counter (firmed by document type,
 * access mode and financial year) and returns the new value. GST and NON-GST
 * invoices therefore count on entirely separate sequences and can never collide.
 */
export async function nextDocumentSequence(
  firmId: string,
  documentType: string,
  accessMode: TaxMode,
  financialYear: string,
  db: Db = prisma,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "document_sequences"
      ("id", "firmId", "documentType", "accessMode", "financialYear", "value", "updatedAt")
    VALUES (gen_random_uuid()::text, ${firmId}, ${documentType}, ${accessMode}::"TaxMode", ${financialYear}, 1, NOW())
    ON CONFLICT ("firmId", "documentType", "accessMode", "financialYear")
    DO UPDATE SET "value" = "document_sequences"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1;
}

/**
 * Sets or advances a per-firm document counter to at least the given minimum value.
 * Used when historical data is seeded or imported so that next generated document
 * number seamlessly continues from the highest existing number.
 */
export async function syncDocumentSequenceFloor(
  firmId: string,
  documentType: string,
  accessMode: TaxMode,
  financialYear: string,
  floorValue: number,
  db: Db = prisma,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "document_sequences"
      ("id", "firmId", "documentType", "accessMode", "financialYear", "value", "updatedAt")
    VALUES (gen_random_uuid()::text, ${firmId}, ${documentType}, ${accessMode}::"TaxMode", ${financialYear}, ${floorValue}, NOW())
    ON CONFLICT ("firmId", "documentType", "accessMode", "financialYear")
    DO UPDATE SET "value" = GREATEST("document_sequences"."value", ${floorValue}), "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? floorValue;
}

/** 2026-27 → "26-27". April–March Indian financial year. */
export function financialYearFor(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = (startYear + 1) % 100;
  return `${String(startYear % 100).padStart(2, "0")}-${String(endYearShort).padStart(2, "0")}`;
}

export const DOCUMENT_TYPES = {
  INVOICE: "invoice",
  QUOTATION: "quotation",
  SALES_ORDER: "sales_order",
  PURCHASE_ORDER: "purchase_order",
  PURCHASE_INVOICE: "purchase_invoice",
  SALES_RETURN: "sales_return",
  PURCHASE_RETURN: "purchase_return",
  PAYMENT: "payment",
  CREDIT_NOTE: "credit_note",
  DEBIT_NOTE: "debit_note",
  STOCK_TRANSFER: "stock_transfer",
  EXPENSE: "expense",
  CUSTOMER: "customer",
  SUPPLIER: "supplier",
} as const;

/** Turn a prefix template like "TT/GST/{FY}/" + 4-digit padding into a number. */
function formatNumber(prefix: string, value: number, width = 4): string {
  return `${prefix}${String(value).padStart(width, "0")}`;
}

/** Checks if a document number is already used in the database to prevent P2002 collisions. */
async function isDocumentNumberUsed(
  documentType: string,
  docNumber: string,
  db: Db,
): Promise<boolean> {
  try {
    switch (documentType) {
      case DOCUMENT_TYPES.INVOICE: {
        const found = await db.invoice.findFirst({ where: { invoiceNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.QUOTATION: {
        const found = await db.quotation.findFirst({ where: { quotationNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.SALES_ORDER: {
        const found = await db.salesOrder.findFirst({ where: { orderNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.PURCHASE_ORDER: {
        const found = await db.purchaseOrder.findFirst({ where: { poNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.PURCHASE_INVOICE: {
        const found = await db.purchaseInvoice.findFirst({ where: { invoiceNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.SALES_RETURN: {
        const found = await db.salesReturn.findFirst({ where: { returnNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.PURCHASE_RETURN: {
        const found = await db.purchaseReturn.findFirst({ where: { returnNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.PAYMENT: {
        const found = await db.payment.findFirst({ where: { paymentNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.EXPENSE: {
        const found = await db.expense.findFirst({ where: { expenseNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      case DOCUMENT_TYPES.STOCK_TRANSFER: {
        const found = await db.stockTransfer.findFirst({ where: { transferNumber: docNumber }, select: { id: true } });
        return Boolean(found);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Allocates the next document number for a firm. The prefixes follow
 * firm configuration or defaults — GST: TT/GST/26-27/0001, non-GST: TT/NG/26-27/0001.
 * Automatically checks uniqueness to prevent duplicate collisions.
 */
export async function nextDocumentNumber(
  firmId: string,
  documentType: string,
  accessMode: TaxMode,
  db: Db = prisma,
  date: Date = new Date(),
): Promise<string> {
  const fy = financialYearFor(date);

  const [firm, settings] = await Promise.all([
    db.firm.findUnique({
      where: { id: firmId },
      select: { code: true, invoicePrefix: true, quotationPrefix: true, purchasePrefix: true },
    }),
    db.setting.findMany({
      where: { firmId, key: { in: [`sequence_${documentType}_${accessMode.toLowerCase()}`, `sequence_${documentType}`] } },
    }),
  ]);

  const map = new Map(settings.map((s) => [s.key, s.value]));
  const custom = map.get(`sequence_${documentType}_${accessMode.toLowerCase()}`) ?? map.get(`sequence_${documentType}`);

  const firmCode = firm?.code ?? "TT";

  let prefix: string;
  if (custom) {
    prefix = custom
      .replace("{FY}", fy)
      .replace("{MODE}", accessMode === "GST" ? "GST" : "NG")
      .replace("{TYPE}", documentType.toUpperCase());
  } else if (documentType === DOCUMENT_TYPES.INVOICE) {
    const invPre = firm?.invoicePrefix || firmCode;
    prefix = accessMode === "GST" ? `${invPre}/GST/${fy}/` : `${invPre}/NG/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.QUOTATION) {
    const qtPre = firm?.quotationPrefix || firmCode;
    prefix = `${qtPre}/QT/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.SALES_ORDER) {
    prefix = `${firmCode}/SO/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PURCHASE_ORDER) {
    const poPre = firm?.purchasePrefix || firmCode;
    prefix = `${poPre}/PO/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PURCHASE_INVOICE) {
    const poPre = firm?.purchasePrefix || firmCode;
    prefix = `${poPre}/PI/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.SALES_RETURN) {
    prefix = `${firmCode}/SR/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PURCHASE_RETURN) {
    prefix = `${firmCode}/PR/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.PAYMENT) {
    prefix = `${firmCode}/PAY/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.CREDIT_NOTE) {
    prefix = `${firmCode}/CN/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.DEBIT_NOTE) {
    prefix = `${firmCode}/DN/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.STOCK_TRANSFER) {
    prefix = `${firmCode}/ST/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.EXPENSE) {
    prefix = `${firmCode}/EXP/${fy}/`;
  } else if (documentType === DOCUMENT_TYPES.CUSTOMER) {
    prefix = "CUS";
  } else if (documentType === DOCUMENT_TYPES.SUPPLIER) {
    prefix = "SUP";
  } else {
    prefix = `${firmCode}/${documentType.toUpperCase()}/${fy}/`;
  }

  // For invoices, ensure the counter floor is synchronized with the highest existing invoice number in the DB
  if (documentType === DOCUMENT_TYPES.INVOICE) {
    try {
      const existingInvoices = await db.invoice.findMany({
        where: { firmId, financialYear: fy },
        select: { invoiceNumber: true },
      });
      let maxNumber = 0;
      for (const inv of existingInvoices) {
        if (inv.invoiceNumber.toUpperCase().includes("SAMPLE")) continue;
        if (inv.invoiceNumber.startsWith("HIST/")) continue;
        const match = inv.invoiceNumber.match(/(\d+)(?!.*\d)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber && num < 1000000) {
            maxNumber = num;
          }
        }
      }
      if (maxNumber > 0) {
        await syncDocumentSequenceFloor(firmId, documentType, accessMode, fy, maxNumber, db);
      }
    } catch {
      // Non-fatal fallback
    }
  }

  let seq = await nextDocumentSequence(firmId, documentType, accessMode, fy, db);

  // A template containing {N} is used as-is with the plain, unpadded counter
  // (e.g. "{N}" → "217"); any other template keeps the "prefix + 4 digits" form.
  const format = (value: number) => (custom?.includes("{N}") ? prefix.replace("{N}", String(value)) : formatNumber(prefix, value));

  // Guarantee uniqueness: loop until a free number is found
  while (true) {
    const candidate = format(seq);
    const used = await isDocumentNumberUsed(documentType, candidate, db);
    if (!used) return candidate;
    seq = await nextDocumentSequence(firmId, documentType, accessMode, fy, db);
  }
}

/** Short customer/supplier codes: CUS00001. */
export const nextCustomerCode = async (firmId: string, db: Db = prisma) => {
  let seq = await nextDocumentSequence(firmId, DOCUMENT_TYPES.CUSTOMER, "NON_GST", "ALL", db);
  while (true) {
    const code = formatNumber("CUS", seq, 5);
    const existing = await db.customer.findFirst({
      where: { firmId, code },
      select: { id: true },
    });
    if (!existing) return code;
    seq = await nextDocumentSequence(firmId, DOCUMENT_TYPES.CUSTOMER, "NON_GST", "ALL", db);
  }
};

export const nextSupplierCode = async (firmId: string, db: Db = prisma) => {
  let seq = await nextDocumentSequence(firmId, DOCUMENT_TYPES.SUPPLIER, "NON_GST", "ALL", db);
  while (true) {
    const code = formatNumber("SUP", seq, 5);
    const existing = await db.supplier.findFirst({
      where: { firmId, code },
      select: { id: true },
    });
    if (!existing) return code;
    seq = await nextDocumentSequence(firmId, DOCUMENT_TYPES.SUPPLIER, "NON_GST", "ALL", db);
  }
};
