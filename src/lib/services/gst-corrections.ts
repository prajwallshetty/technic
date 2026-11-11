import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { FOREIGN_POS, STATES, normaliseUqc, stateName } from "@/lib/gst/gstr1/masters";
import { checkGstin } from "@/lib/gst/gstr1/util";

/**
 * Corrections made from the GSTR-1 validation screen. They change GST
 * classification fields only — place of supply, supply type, HSN, unit,
 * GSTIN — and never an amount, quantity or rate. Every change is validated
 * and written to the audit log with before and after values.
 */
interface Actor {
  firmId: string;
  userId: string;
}

const SUPPLY_TYPES = ["REGULAR", "SEZ_WITH_PAYMENT", "SEZ_WITHOUT_PAYMENT", "DEEMED_EXPORT", "EXPORT_WITH_PAYMENT", "EXPORT_WITHOUT_PAYMENT"] as const;
const TAXABILITY = ["TAXABLE", "NIL_RATED", "EXEMPTED", "NON_GST"] as const;
const TREATMENTS = ["REGISTERED", "UNREGISTERED", "SEZ", "DEEMED_EXPORT", "OVERSEAS", "UIN_HOLDER", "COMPOSITION"] as const;

export interface InvoiceGstInput {
  /** Two-digit state code from the portal's list ("29"), or "96" for exports. */
  placeOfSupplyCode?: string | null;
  supplyType?: (typeof SUPPLY_TYPES)[number];
  reverseCharge?: boolean;
  ecommerceGstin?: string | null;
  billToGstin?: string | null;
  portCode?: string | null;
  shippingBillNumber?: string | null;
  shippingBillDate?: string | null; // yyyy-mm-dd
  /** Also copy a corrected GSTIN to the customer record. */
  alsoUpdateCustomer?: boolean;
}

export async function updateInvoiceGstDetails(actor: Actor, invoiceId: string, input: InvoiceGstInput) {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, firmId: actor.firmId } });
  if (!invoice) throw new NotFoundError("Invoice not found");
  if (invoice.status === "CANCELLED") throw new BusinessRuleError("A cancelled invoice cannot be edited");
  const data: Prisma.InvoiceUpdateInput = {};

  if (input.placeOfSupplyCode !== undefined) {
    const code = input.placeOfSupplyCode?.trim() || null;
    if (code && !STATES[code] && code !== FOREIGN_POS.code) throw new BusinessRuleError(`"${code}" is not a place-of-supply code on the portal's list`);
    data.placeOfSupplyCode = code;
    data.placeOfSupply = code ? stateName(code) : null;
  }
  if (input.supplyType !== undefined) {
    if (!SUPPLY_TYPES.includes(input.supplyType)) throw new BusinessRuleError("Unknown supply type");
    data.supplyType = input.supplyType;
  }
  if (input.reverseCharge !== undefined) data.reverseCharge = input.reverseCharge;
  if (input.ecommerceGstin !== undefined) {
    const g = input.ecommerceGstin?.trim().toUpperCase() || null;
    if (g && checkGstin(g) !== "OK") throw new BusinessRuleError("The e-commerce operator's GSTIN is not valid");
    data.ecommerceGstin = g;
  }
  if (input.billToGstin !== undefined) {
    const g = input.billToGstin?.trim().toUpperCase() || null;
    if (g) {
      const check = checkGstin(g);
      if (check !== "OK") throw new BusinessRuleError(`GSTIN ${g} is not valid (${check === "BAD_CHECK_DIGIT" ? "check digit does not match" : check === "BAD_STATE" ? "unknown state code" : "wrong format"}). Confirm it on the GST portal.`);
    }
    data.billToGstin = g;
  }
  if (input.portCode !== undefined) data.portCode = input.portCode?.trim() || null;
  if (input.shippingBillNumber !== undefined) data.shippingBillNumber = input.shippingBillNumber?.trim() || null;
  if (input.shippingBillDate !== undefined) {
    if (input.shippingBillDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.shippingBillDate)) throw new BusinessRuleError("Shipping bill date must be yyyy-mm-dd");
    data.shippingBillDate = input.shippingBillDate ? new Date(`${input.shippingBillDate}T00:00:00+05:30`) : null;
  }
  if (Object.keys(data).length === 0) throw new BusinessRuleError("Nothing to change");

  const before = pick(invoice, Object.keys(data));
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.invoice.update({ where: { id: invoice.id }, data });
    if (input.alsoUpdateCustomer && input.billToGstin !== undefined) {
      await tx.customer.update({ where: { id: invoice.customerId }, data: { gstin: data.billToGstin as string | null } });
    }
    return row;
  });
  await recordAudit({
    action: "INVOICE_GST_UPDATED", entity: "Invoice", entityId: invoice.id,
    summary: `${invoice.invoiceNumber}: GST details corrected (${Object.keys(data).join(", ")})`,
    firmId: actor.firmId, branchId: invoice.branchId, userId: actor.userId, before, after: pick(updated, Object.keys(data)),
  });
  return updated;
}

export interface LineGstInput {
  hsnCode?: string | null;
  uqc?: string | null;
  taxability?: (typeof TAXABILITY)[number];
  /** Also set the same value on the product master. */
  updateProduct?: boolean;
}

function checkHsn(hsn: string | null | undefined) {
  const v = hsn?.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v) || ![2, 4, 6, 8].includes(v.length)) throw new BusinessRuleError(`HSN/SAC "${v}" must be a 2, 4, 6 or 8 digit code`);
  return v;
}

export async function updateInvoiceLineGstDetails(actor: Actor, lineId: string, input: LineGstInput) {
  const line = await prisma.invoiceLine.findFirst({ where: { id: lineId, invoice: { firmId: actor.firmId } }, include: { invoice: { select: { invoiceNumber: true, status: true, branchId: true } } } });
  if (!line) throw new NotFoundError("Invoice line not found");
  if (line.invoice.status === "CANCELLED") throw new BusinessRuleError("A cancelled invoice cannot be edited");
  const data: Prisma.InvoiceLineUpdateInput = {};
  if (input.hsnCode !== undefined) data.hsnCode = checkHsn(input.hsnCode);
  if (input.uqc !== undefined) {
    const uqc = input.uqc ? normaliseUqc(input.uqc) : null;
    if (input.uqc && !uqc) throw new BusinessRuleError(`"${input.uqc}" is not an official Unit Quantity Code`);
    data.uqc = uqc?.split("-")[0] ?? null;
  }
  if (input.taxability !== undefined) {
    if (!TAXABILITY.includes(input.taxability)) throw new BusinessRuleError("Unknown taxability");
    if (input.taxability !== "TAXABLE" && Number(line.cgstAmount) + Number(line.sgstAmount) + Number(line.igstAmount) > 0.005) {
      throw new BusinessRuleError("This line carries tax, so it cannot be nil-rated, exempted or non-GST");
    }
    data.taxability = input.taxability;
  }
  if (Object.keys(data).length === 0) throw new BusinessRuleError("Nothing to change");
  const before = pick(line, Object.keys(data));
  await prisma.$transaction(async (tx) => {
    await tx.invoiceLine.update({ where: { id: line.id }, data });
    if (input.updateProduct && line.productId) {
      const pd: Prisma.ProductUpdateInput = {};
      if (data.hsnCode !== undefined) pd.hsnCode = data.hsnCode as string | null;
      if (data.uqc !== undefined) pd.uqc = data.uqc as string | null;
      if (data.taxability !== undefined) pd.taxability = data.taxability as never;
      if (Object.keys(pd).length) await tx.product.update({ where: { id: line.productId }, data: pd });
    }
  });
  await recordAudit({
    action: "INVOICE_GST_UPDATED", entity: "InvoiceLine", entityId: line.id,
    summary: `${line.invoice.invoiceNumber} line "${line.description.slice(0, 30)}": ${Object.keys(data).join(", ")} corrected`,
    firmId: actor.firmId, branchId: line.invoice.branchId, userId: actor.userId, before, after: data,
  });
}

/**
 * Sets the HSN (and unit) for every invoice line of one product that has none —
 * the usual fix when one catalogue item is missing its code on many invoices.
 * Lines that already have a code are left alone.
 */
export async function setHsnForProductLines(actor: Actor, productId: string, input: { hsnCode: string; uqc?: string | null; updateProduct?: boolean }) {
  const product = await prisma.product.findFirst({ where: { id: productId, firmId: actor.firmId }, select: { id: true, name: true } });
  if (!product) throw new NotFoundError("Product not found");
  const hsn = checkHsn(input.hsnCode);
  if (!hsn) throw new BusinessRuleError("Enter the HSN/SAC code");
  const uqc = input.uqc ? normaliseUqc(input.uqc) : null;
  if (input.uqc && !uqc) throw new BusinessRuleError(`"${input.uqc}" is not an official Unit Quantity Code`);
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.invoiceLine.updateMany({
      where: { productId, invoice: { firmId: actor.firmId, status: { not: "CANCELLED" } }, OR: [{ hsnCode: null }, { hsnCode: "" }] },
      data: { hsnCode: hsn, ...(uqc ? { uqc: uqc.split("-")[0] } : {}) },
    });
    if (input.updateProduct) await tx.product.update({ where: { id: productId }, data: { hsnCode: hsn, ...(uqc ? { uqc: uqc.split("-")[0] } : {}) } });
    return r;
  });
  await recordAudit({
    action: "INVOICE_GST_UPDATED", entity: "Product", entityId: productId,
    summary: `HSN ${hsn} set on ${result.count} invoice line(s) of "${product.name.slice(0, 40)}"${input.updateProduct ? " and on the product" : ""}`,
    firmId: actor.firmId, userId: actor.userId, after: { hsnCode: hsn, uqc: uqc?.split("-")[0] ?? null, lines: result.count },
  });
  return { updated: result.count };
}

export async function setCustomerGstTreatment(actor: Actor, customerId: string, treatment: (typeof TREATMENTS)[number] | null) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, firmId: actor.firmId }, select: { id: true, name: true, gstTreatment: true } });
  if (!customer) throw new NotFoundError("Customer not found");
  if (treatment !== null && !TREATMENTS.includes(treatment)) throw new BusinessRuleError("Unknown GST treatment");
  await prisma.customer.update({ where: { id: customerId }, data: { gstTreatment: treatment } });
  await recordAudit({
    action: "INVOICE_GST_UPDATED", entity: "Customer", entityId: customerId, summary: `${customer.name}: GST treatment ${customer.gstTreatment ?? "unset"} → ${treatment ?? "unset"}`,
    firmId: actor.firmId, userId: actor.userId, before: { gstTreatment: customer.gstTreatment }, after: { gstTreatment: treatment },
  });
}

function pick(obj: object, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (obj as Record<string, unknown>)[k] ?? null;
  return out;
}
