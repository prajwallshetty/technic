import "server-only";

import { prisma } from "@/lib/prisma";
import type { TaxMode } from "@/generated/prisma/enums";

export type AuditActionName =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "ACCESS_CODE_USED"
  | "ACCESS_CODE_FAILED"
  | "ACCESS_CODE_CREATED"
  | "ACCESS_CODE_UPDATED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_DELETED"
  | "STOCK_ADJUSTED"
  | "STOCK_TRANSFERRED"
  | "PURCHASE_CREATED"
  | "PURCHASE_RECEIVED"
  | "PURCHASE_RETURNED"
  | "SALE_CREATED"
  | "SALE_RETURNED"
  | "INVOICE_CREATED"
  | "INVOICE_CANCELLED"
  | "INVOICE_DELETED"
  | "PAYMENT_CREATED"
  | "QUOTATION_CREATED"
  | "QUOTATION_CONVERTED"
  | "QUOTATION_DELETED"
  | "CUSTOMER_CREATED"
  | "SUPPLIER_CREATED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_PERMISSION_CHANGED"
  | "FIRM_UPDATED"
  | "WARRANTY_CLAIMED"
  | "EXPENSE_CREATED"
  | "SETTING_UPDATED";

const AUDIT_ACTIONS: AuditActionName[] = [
  "LOGIN", "LOGIN_FAILED", "LOGOUT", "ACCESS_CODE_USED", "ACCESS_CODE_FAILED",
  "ACCESS_CODE_CREATED", "ACCESS_CODE_UPDATED", "PRODUCT_CREATED", "PRODUCT_UPDATED",
  "PRODUCT_DELETED", "STOCK_ADJUSTED", "STOCK_TRANSFERRED", "PURCHASE_CREATED",
  "PURCHASE_RECEIVED", "PURCHASE_RETURNED", "SALE_CREATED", "SALE_RETURNED",
  "INVOICE_CREATED", "INVOICE_CANCELLED", "INVOICE_DELETED", "PAYMENT_CREATED", "QUOTATION_CREATED",
  "QUOTATION_CONVERTED", "QUOTATION_DELETED", "CUSTOMER_CREATED", "SUPPLIER_CREATED", "USER_CREATED",
  "USER_UPDATED", "USER_PERMISSION_CHANGED", "FIRM_UPDATED", "WARRANTY_CLAIMED",
  "EXPENSE_CREATED", "SETTING_UPDATED",
];

/** Human-readable label for the activity log. */
export const AUDIT_ACTION_LABELS: Record<AuditActionName, string> = {
  LOGIN: "Login",
  LOGIN_FAILED: "Failed login",
  LOGOUT: "Logout",
  ACCESS_CODE_USED: "Access code used",
  ACCESS_CODE_FAILED: "Failed access code",
  ACCESS_CODE_CREATED: "Access code created",
  ACCESS_CODE_UPDATED: "Access code updated",
  PRODUCT_CREATED: "Product created",
  PRODUCT_UPDATED: "Product updated",
  PRODUCT_DELETED: "Product deleted",
  STOCK_ADJUSTED: "Stock adjusted",
  STOCK_TRANSFERRED: "Stock transferred",
  PURCHASE_CREATED: "Purchase order created",
  PURCHASE_RECEIVED: "Goods received",
  PURCHASE_RETURNED: "Purchase return",
  SALE_CREATED: "Sale created",
  SALE_RETURNED: "Sales return",
  INVOICE_CREATED: "Invoice created",
  INVOICE_CANCELLED: "Invoice cancelled",
  INVOICE_DELETED: "Invoice deleted",
  PAYMENT_CREATED: "Payment recorded",
  QUOTATION_CREATED: "Quotation created",
  QUOTATION_CONVERTED: "Quotation converted",
  QUOTATION_DELETED: "Quotation deleted",
  CUSTOMER_CREATED: "Customer created",
  SUPPLIER_CREATED: "Supplier created",
  USER_CREATED: "User created",
  USER_UPDATED: "User updated",
  USER_PERMISSION_CHANGED: "Permissions changed",
  FIRM_UPDATED: "Firm updated",
  WARRANTY_CLAIMED: "Warranty claimed",
  EXPENSE_CREATED: "Expense recorded",
  SETTING_UPDATED: "Settings updated",
};

/** The mode label appended to summaries so the audit trail shows the context. */
export function modeLabel(mode: TaxMode): string {
  return mode === "GST" ? "GST" : "non-GST";
}

interface AuditInput {
  action: AuditActionName;
  entity: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  firmId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const SECRET_KEYS = /pass(word)?|secret|token|hash|key|credential/i;

/** Recursively redacts secret-looking values before anything reaches the log. */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Writes an audit row. Never throws into the caller's flow — a failed audit
 * write is logged but must not roll back the business operation it observed.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        before: input.before === undefined ? undefined : (redact(input.before) as never),
        after: input.after === undefined ? undefined : (redact(input.after) as never),
        firmId: input.firmId ?? null,
        branchId: input.branchId ?? null,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record", input.action, error);
  }
}
