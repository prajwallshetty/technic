import "server-only";

import { prisma } from "@/lib/prisma";
import type { TaxMode } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { financialYearFor } from "@/lib/sequence";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * GST engine. Tax mode (CGST+SGST vs IGST) is decided on the server from the
 * seller's registered state and the customer's place of supply — never from a
 * frontend selection. Rates come from the product line (per-product tax
 * configuration), never a hardcoded global rate.
 */

export interface TaxLineInput {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstRate: number;
}

export interface TaxLineResult {
  gross: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  lineTotal: number;
}

export interface TaxSummary {
  lines: TaxLineResult[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalBeforeRound: number;
  roundOff: number;
  totalAmount: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Same-state (intra-state) → CGST + SGST, each half the rate.
 * Inter-state → IGST at the full rate.
 *
 * Line unit prices are GST-inclusive shelf prices in GST mode: tax is
 * extracted from (not added on top of) the quoted amount, so the invoice
 * grand total always equals the price taken at the counter.
 */
export function isSameState(sellerState: string | null | undefined, placeOfSupply: string | null | undefined): boolean {
  const seller = (sellerState ?? "").trim().toLowerCase();
  const supply = (placeOfSupply ?? "").trim().toLowerCase();
  if (!seller || !supply) return true; // default intra-state
  return seller === supply;
}

export function computeTaxSummary(
  lines: TaxLineInput[],
  options: { mode: TaxMode; sameState: boolean; manualRoundOff?: number | null },
): TaxSummary {
  const results: TaxLineResult[] = [];
  let subtotal = 0;
  let discountAmount = 0;
  let taxableAmount = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  for (const line of lines) {
    const gross = round2(line.quantity * line.unitPrice);
    const discount = round2((gross * line.discountPercent) / 100);
    const discountedGross = round2(gross - discount);

    let taxableValue = discountedGross;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (options.mode === "GST" && line.gstRate > 0) {
      // Catalogue prices are GST-inclusive shelf prices: the customer pays
      // exactly what the POS screen quotes. Split the discounted gross into
      // its taxable base and embedded tax so the invoice total stays equal
      // to the amount taken at the counter.
      taxableValue = round2(discountedGross / (1 + line.gstRate / 100));
      if (options.sameState) {
        cgst = round2((taxableValue * line.gstRate) / 200);
        sgst = round2((taxableValue * line.gstRate) / 200);
      } else {
        igst = round2((taxableValue * line.gstRate) / 100);
      }
    }

    const lineTotal = round2(taxableValue + cgst + sgst + igst);

    subtotal += gross;
    discountAmount += discount;
    taxableAmount += taxableValue;
    cgstTotal += cgst;
    sgstTotal += sgst;
    igstTotal += igst;

    results.push({ gross, discount, taxableValue, cgst, sgst, igst, lineTotal });
  }

  const totalBeforeRound = round2(taxableAmount + cgstTotal + sgstTotal + igstTotal);
  const roundOff =
    typeof options.manualRoundOff === "number" && !isNaN(options.manualRoundOff)
      ? round2(options.manualRoundOff)
      : round2(Math.round(totalBeforeRound) - totalBeforeRound);
  const totalAmount = round2(totalBeforeRound + roundOff);

  return {
    lines: results,
    subtotal: round2(subtotal),
    discountAmount: round2(discountAmount),
    taxableAmount: round2(taxableAmount),
    cgstAmount: round2(cgstTotal),
    sgstAmount: round2(sgstTotal),
    igstAmount: round2(igstTotal),
    totalBeforeRound,
    roundOff,
    totalAmount,
  };
}

/** The seller state for a firm (falls back to the issuing branch's state). */
export async function sellerStateFor(
  firmId: string,
  branchId: string | null | undefined,
  db: Db = prisma,
): Promise<string | null> {
  if (branchId) {
    const branch = await db.branch.findUnique({ where: { id: branchId }, select: { state: true } });
    if (branch?.state) return branch.state;
  }
  const firm = await db.firm.findUnique({ where: { id: firmId }, select: { state: true } });
  return firm?.state ?? null;
}

/** The financial year string stamped on invoices for numbering. */
export { financialYearFor };
