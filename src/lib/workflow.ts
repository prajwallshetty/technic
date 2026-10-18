import type { TaxMode } from "@/generated/prisma/enums";

/**
 * Document type → friendly label. GST documents say "Tax Invoice", non-GST
 * documents say "Bill"/"Invoice" per the handover's wording rules.
 */
export const INVOICE_KIND_LABEL: Record<string, string> = {
  TAX_INVOICE: "Tax Invoice",
  NON_GST_BILL: "Invoice / Bill",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const QUOTATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  CONVERTED: "Converted",
};

export const SALES_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

export const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const PURCHASE_INVOICE_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const SALES_RETURN_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const STOCK_TRANSFER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  REQUESTED: "Requested",
  APPROVED: "Approved",
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const SERIAL_STATUS_LABELS: Record<string, string> = {
  IN_STOCK: "In stock",
  SOLD: "Sold",
  RETURNED: "Returned",
  DAMAGED: "Damaged",
  WARRANTY: "Warranty",
};

export const WARRANTY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired",
  CLAIMED: "Claimed",
  REPLACED: "Replaced",
};

export const PAYMENT_DIRECTION_LABELS: Record<string, string> = {
  CUSTOMER_IN: "Customer receipt",
  SUPPLIER_OUT: "Supplier payment",
  REFUND_OUT: "Refund",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PAID: "Paid",
  PARTIAL: "Partial",
  PENDING: "Pending",
  OVERDUE: "Overdue",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  RETAIL: "Retail",
  BUSINESS: "Business",
  DEALER: "Dealer",
  CORPORATE: "Corporate",
  OTHER: "Other",
};

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  RENT: "Rent",
  ELECTRICITY: "Electricity",
  INTERNET: "Internet",
  SALARY: "Salary",
  TRANSPORT: "Transport",
  OFFICE: "Office",
  MARKETING: "Marketing",
  MAINTENANCE: "Maintenance",
  OTHER: "Other",
};

export const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  INCREASE: "Increase",
  DECREASE: "Decrease",
  DAMAGE: "Damage",
  LOST: "Lost",
  CORRECTION: "Correction",
};

export const ACCESS_MODE_LABELS: Record<TaxMode, string> = {
  GST: "GST",
  NON_GST: "Non-GST",
};

export type BadgeTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

/**
 * Badge tone mapping used by StatusBadge across the screens. "default" is an
 * accepted legacy alias for "neutral" so old call sites keep compiling.
 */
export const STATUS_TONES: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  // invoices
  ISSUED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
  // quotation
  DRAFT: "default",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "warning",
  CONVERTED: "success",
  // sales orders
  CONFIRMED: "info",
  INVOICED: "success",
  // purchases
  UNPAID: "warning",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  // serials
  IN_STOCK: "success",
  SOLD: "info",
  RETURNED: "warning",
  DAMAGED: "danger",
  WARRANTY: "info",
  // transfers
  REQUESTED: "info",
  APPROVED: "info",
  IN_TRANSIT: "warning",
  // warranty
  ACTIVE: "success",
  CLAIMED: "warning",
  REPLACED: "success",
  // invoice import
  QUEUED: "default",
  PROCESSING: "info",
  NEEDS_REVIEW: "warning",
  READY: "success",
  FAILED: "danger",
  DUPLICATE: "warning",
  POSTED: "success",
  COMPLETED: "success",
  // payments
  PARTIAL: "warning",
  PENDING: "warning",
  OVERDUE: "danger",
};

const BADGE_TONES: BadgeTone[] = ["neutral", "info", "progress", "success", "warning", "danger"];

export function isBadgeTone(value: string): value is BadgeTone {
  return BADGE_TONES.includes(value as BadgeTone);
}

/** Map a STATUS_TONES entry ("default" legacy alias) to a BadgeTone. */
export function toBadgeTone(value: string | undefined): BadgeTone {
  if (value === undefined) return "neutral";
  const normalized = value === "default" ? "neutral" : value;
  return isBadgeTone(normalized) ? normalized : "neutral";
}

/** Resolve a status string to a badge tone, with a neutral fallback. */
export function toneFor(status: string | null | undefined): BadgeTone {
  if (!status) return "neutral";
  return toBadgeTone(STATUS_TONES[status]);
}