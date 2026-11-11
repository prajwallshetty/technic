import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

import { periodFor } from "./report";
import type {
  FirmGstProfile, GstAdvance, GstAdvanceAdjustment, GstDoc, GstLine, GstTreatment, GstrInput, RegisterTotals, SupplyType, Taxability,
} from "./types";
import { stateCodeFromGstin } from "./masters";

/**
 * Reads the real ERP records for a GSTIN and tax period and normalises them for
 * the engine. Read-only: nothing is written, and no missing value is filled in.
 *
 * Dates are taken in India time (IST, UTC+5:30), the zone invoices are issued
 * in — an invoice dated 1 September belongs to September, not to August.
 */
const IST_MS = 330 * 60_000;
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istStart = (iso: string) => new Date(`${iso}T00:00:00.000+05:30`);
export const istEnd = (iso: string) => new Date(`${iso}T23:59:59.999+05:30`);

const num = (v: Prisma.Decimal | number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export interface GstinOption {
  gstin: string;
  label: string;
}

export interface LoadOptions {
  firmId: string;
  /** The GSTIN being reported; defaults to the firm's. */
  gstin?: string;
  /** yyyy-mm-dd (India dates), inclusive. */
  from: string;
  to: string;
  /** Restrict to one branch (users who cannot see every branch). */
  branchId?: string;
}

/** The GSTINs this firm can report for: its own, plus any branch registered separately. */
export async function gstinOptions(firmId: string): Promise<GstinOption[]> {
  const [firm, branches] = await Promise.all([
    prisma.firm.findUnique({ where: { id: firmId }, select: { gstin: true, name: true } }),
    prisma.branch.findMany({ where: { firmId, isActive: true, gstin: { not: null } }, select: { gstin: true, name: true } }),
  ]);
  const out = new Map<string, GstinOption>();
  if (firm?.gstin) out.set(firm.gstin, { gstin: firm.gstin, label: `${firm.gstin} — ${firm.name}` });
  for (const b of branches) if (b.gstin && !out.has(b.gstin)) out.set(b.gstin, { gstin: b.gstin, label: `${b.gstin} — ${b.name}` });
  return [...out.values()];
}

async function settingsOf(firmId: string) {
  const rows = await prisma.setting.findMany({ where: { firmId, key: { in: ["gst_trade_name", "gst_aato_band", "gst_turnover_prev_fy", "gst_turnover_cur_fy", "company_gstin"] } } });
  return new Map(rows.map((r) => [r.key, r.value]));
}

const asNumber = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function loadGstr1Input(opts: LoadOptions): Promise<GstrInput> {
  const { firmId, from, to } = opts;
  const [firm, settings] = await Promise.all([
    prisma.firm.findUniqueOrThrow({ where: { id: firmId }, select: { gstin: true, legalName: true, name: true, stateCode: true } }),
    settingsOf(firmId),
  ]);
  const gstin = opts.gstin ?? firm.gstin ?? "";

  // Which branches belong to this GSTIN: a branch with its own GSTIN reports under it;
  // branches without one report under the firm's GSTIN.
  const branches = await prisma.branch.findMany({ where: { firmId }, select: { id: true, gstin: true } });
  const branchIds = branches.filter((b) => (b.gstin ? b.gstin === gstin : gstin === firm.gstin)).map((b) => b.id);
  const branchFilter = { branchId: { in: opts.branchId ? branchIds.filter((id) => id === opts.branchId) : branchIds } };

  const profile: FirmGstProfile = {
    gstin,
    legalName: firm.legalName ?? null,
    tradeName: settings.get("gst_trade_name")?.trim() || null,
    stateCode: stateCodeFromGstin(gstin),
    aatoBand: settings.get("gst_aato_band") === "ABOVE_5CR" ? "ABOVE_5CR" : settings.get("gst_aato_band") === "UPTO_5CR" ? "UPTO_5CR" : null,
    previousFyTurnover: asNumber(settings.get("gst_turnover_prev_fy")),
    currentFyTurnover: asNumber(settings.get("gst_turnover_cur_fy")),
  };

  const range = { gte: istStart(from), lte: istEnd(to) };
  const invoiceWhere: Prisma.InvoiceWhereInput = { firmId, kind: "TAX_INVOICE", invoiceDate: range, ...branchFilter };

  // ---- invoices (batched, so a large period does not load at once) -------------------------------------
  const docs: GstDoc[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.invoice.findMany({
      where: invoiceWhere, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        customer: { select: { gstTreatment: true } },
        lines: { orderBy: { id: "asc" }, include: { product: { select: { unit: true } } } },
      },
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;
    for (const inv of batch) {
      const cancelled = inv.status === "CANCELLED";
      docs.push({
        kind: "INVOICE", id: inv.id, number: inv.invoiceNumber, date: istDate(inv.invoiceDate), status: cancelled ? "CANCELLED" : "ISSUED",
        party: { name: inv.billToName, gstin: inv.billToGstin?.trim() || null, treatment: (inv.customer?.gstTreatment as GstTreatment | null) ?? null },
        supplyType: inv.supplyType as SupplyType, placeOfSupplyName: inv.placeOfSupply, placeOfSupplyCode: inv.placeOfSupplyCode,
        reverseCharge: inv.reverseCharge, ecommerceGstin: inv.ecommerceGstin,
        exportDetails: inv.supplyType.startsWith("EXPORT") ? { portCode: inv.portCode, shippingBillNumber: inv.shippingBillNumber, shippingBillDate: inv.shippingBillDate ? istDate(inv.shippingBillDate) : null } : null,
        original: null,
        totals: { subtotal: num(inv.subtotal), discount: num(inv.discountAmount), taxable: num(inv.taxableAmount), cgst: num(inv.cgstAmount), sgst: num(inv.sgstAmount), igst: num(inv.igstAmount), cess: num(inv.cessAmount), roundOff: num(inv.roundOff), total: num(inv.totalAmount) },
        lines: cancelled ? [] : inv.lines.map((l, i): GstLine => ({
          lineNo: i + 1, lineId: l.id, productId: l.productId, description: l.description, hsn: l.hsnCode?.trim() || null, uqc: l.uqc ?? l.product?.unit ?? null, quantity: num(l.quantity),
          rate: num(l.gstRate), cessRate: num(l.cessRate), taxability: l.taxability as Taxability, taxable: num(l.taxableValue),
          cgst: num(l.cgstAmount), sgst: num(l.sgstAmount), igst: num(l.igstAmount), cess: num(l.cessAmount), total: num(l.lineTotal),
        })),
        link: `/invoices/${inv.id}`,
      });
    }
    if (batch.length < 500) break;
  }

  // ---- credit / debit notes ---------------------------------------------------------------------------------
  const notes = await prisma.creditDebitNote.findMany({
    where: { firmId, noteDate: range, ...branchFilter }, orderBy: { noteDate: "asc" },
    include: { customer: { select: { gstTreatment: true } }, originalInvoice: { select: { invoiceNumber: true, invoiceDate: true } }, lines: { include: { product: { select: { unit: true } } } } },
  });
  for (const n of notes) {
    const cancelled = n.status === "CANCELLED";
    docs.push({
      kind: n.noteType === "CREDIT" ? "CREDIT_NOTE" : "DEBIT_NOTE", id: n.id, number: n.noteNumber, date: istDate(n.noteDate), status: cancelled ? "CANCELLED" : "ISSUED",
      party: { name: n.billToName, gstin: n.billToGstin?.trim() || null, treatment: (n.customer?.gstTreatment as GstTreatment | null) ?? null },
      supplyType: n.supplyType as SupplyType, placeOfSupplyName: n.placeOfSupply, placeOfSupplyCode: n.placeOfSupplyCode, reverseCharge: n.reverseCharge, ecommerceGstin: null, exportDetails: null,
      original: n.originalInvoiceNumber || n.originalInvoice
        ? { number: n.originalInvoiceNumber ?? n.originalInvoice?.invoiceNumber ?? null, date: n.originalInvoiceDate ? istDate(n.originalInvoiceDate) : n.originalInvoice ? istDate(n.originalInvoice.invoiceDate) : null, foundInErp: !!n.originalInvoice }
        : null,
      totals: { subtotal: num(n.subtotal), discount: 0, taxable: num(n.taxableAmount), cgst: num(n.cgstAmount), sgst: num(n.sgstAmount), igst: num(n.igstAmount), cess: num(n.cessAmount), roundOff: num(n.roundOff), total: num(n.totalAmount) },
      lines: cancelled ? [] : n.lines.map((l, i): GstLine => ({
        lineNo: i + 1, lineId: l.id, productId: l.productId, description: l.description, hsn: l.hsnCode?.trim() || null, uqc: l.uqc ?? l.product?.unit ?? null, quantity: l.quantity, rate: num(l.gstRate), cessRate: num(l.cessRate),
        taxability: l.taxability as Taxability, taxable: num(l.taxableValue), cgst: num(l.cgstAmount), sgst: num(l.sgstAmount), igst: num(l.igstAmount), cess: num(l.cessAmount), total: num(l.lineTotal),
      })),
      link: `/credit-notes/${n.id}`,
    });
  }

  // ---- advances (received in the period, plus those adjusted in it) ------------------------------------------------
  const adjustmentRows = await prisma.advanceAdjustment.findMany({ where: { adjustedAt: range, advance: { firmId, ...branchFilter } } });
  const advanceRows = await prisma.advanceReceipt.findMany({
    where: { firmId, ...branchFilter, OR: [{ receiptDate: range }, { id: { in: adjustmentRows.map((a) => a.advanceId) } }] },
  });
  const advances: GstAdvance[] = advanceRows.map((a) => ({
    id: a.id, number: a.receiptNumber, date: istDate(a.receiptDate), status: a.status, placeOfSupplyCode: a.placeOfSupplyCode, placeOfSupplyName: a.placeOfSupply,
    rate: num(a.gstRate), cessRate: num(a.cessRate), grossAmount: num(a.grossAmount), link: `/payments`,
  }));
  const adjustments: GstAdvanceAdjustment[] = adjustmentRows.map((a) => ({ advanceId: a.advanceId, invoiceId: a.invoiceId, amount: num(a.adjustedAmount), date: istDate(a.adjustedAt) }));

  // ---- independent figures for reconciliation (database aggregation, not the rows above) --------------------------
  const live: Prisma.InvoiceWhereInput = { ...invoiceWhere, status: { not: "CANCELLED" } };
  const [inv, lineAgg] = await Promise.all([
    prisma.invoice.aggregate({ where: live, _count: { _all: true }, _sum: { totalAmount: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, cessAmount: true } }),
    prisma.invoiceLine.aggregate({ where: { invoice: live }, _sum: { taxableValue: true, cgstAmount: true, sgstAmount: true, igstAmount: true } }),
  ]);
  const noteTotals = async (type: "CREDIT" | "DEBIT"): Promise<RegisterTotals> => {
    const a = await prisma.creditDebitNote.aggregate({
      where: { firmId, noteType: type, status: "ISSUED", noteDate: range, ...branchFilter },
      _count: { _all: true }, _sum: { totalAmount: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, cessAmount: true },
    });
    return { count: a._count._all, total: num(a._sum.totalAmount), taxable: num(a._sum.taxableAmount), cgst: num(a._sum.cgstAmount), sgst: num(a._sum.sgstAmount), igst: num(a._sum.igstAmount), cess: num(a._sum.cessAmount) };
  };
  const [creditNotes, debitNotes] = await Promise.all([noteTotals("CREDIT"), noteTotals("DEBIT")]);
  const noteLines = async (type: "CREDIT" | "DEBIT") => {
    const a = await prisma.creditDebitNoteLine.aggregate({
      where: { note: { firmId, noteType: type, status: "ISSUED", noteDate: range, ...branchFilter } },
      _sum: { taxableValue: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
    });
    return { taxable: num(a._sum.taxableValue), cgst: num(a._sum.cgstAmount), sgst: num(a._sum.sgstAmount), igst: num(a._sum.igstAmount) };
  };
  const [creditLines, debitLines] = await Promise.all([noteLines("CREDIT"), noteLines("DEBIT")]);
  const lineNet = (k: "taxable" | "cgst" | "sgst" | "igst") => {
    const own = k === "taxable" ? lineAgg._sum.taxableValue : k === "cgst" ? lineAgg._sum.cgstAmount : k === "sgst" ? lineAgg._sum.sgstAmount : lineAgg._sum.igstAmount;
    return Math.round((num(own) + debitLines[k] - creditLines[k]) * 100) / 100;
  };

  return {
    firm: profile, period: periodFor(from, to), docs, advances, adjustments,
    register: {
      invoices: { count: inv._count._all, total: num(inv._sum.totalAmount), taxable: num(inv._sum.taxableAmount), cgst: num(inv._sum.cgstAmount), sgst: num(inv._sum.sgstAmount), igst: num(inv._sum.igstAmount), cess: num(inv._sum.cessAmount) },
      creditNotes, debitNotes,
    },
    gstSummary: { taxable: lineNet("taxable"), cgst: lineNet("cgst"), sgst: lineNet("sgst"), igst: lineNet("igst") },
    today: istDate(new Date()),
  };
}
