import { round2 } from "@/lib/money";

export type DiscountType = "%" | "₹";

export interface LineDiscountInput {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType;
  discountValue?: number;
  gstRate?: number;
}

export interface BillDiscountInput {
  type: DiscountType;
  value: number;
}

export interface ComputedDiscountLine {
  gross: number;
  lineDiscountAmount: number;
  billDiscountAmount: number;
  totalDiscountAmount: number;
  effectiveDiscountPercent: number;
  netTotal: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
}

export interface ComputedDiscountSummary {
  lines: ComputedDiscountLine[];
  grossSubtotal: number;
  lineDiscountTotal: number;
  billDiscountTotal: number;
  totalDiscount: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  roundOff: number;
  totalAmount: number;
}

/**
 * Computes line-level discounts, proportional bill discount distribution,
 * and resulting GST/taxable figures.
 */
export function computeDiscountSummary({
  lines,
  billDiscount,
  mode = "GST",
  manualRoundOff,
}: {
  lines: LineDiscountInput[];
  billDiscount?: BillDiscountInput | null;
  mode?: "GST" | "NON_GST";
  manualRoundOff?: number | null;
}): ComputedDiscountSummary {
  let grossSubtotal = 0;
  let lineDiscountTotal = 0;

  // First pass: line gross and line discounts
  const intermediateLines = lines.map((line) => {
    const qty = Math.max(0, line.quantity);
    const price = Math.max(0, line.unitPrice);
    const gross = round2(qty * price);
    const discType = line.discountType ?? "%";
    const discVal = Math.max(0, line.discountValue ?? 0);

    let lineDiscountAmount = 0;
    if (discType === "%") {
      const pct = Math.min(100, discVal);
      lineDiscountAmount = round2((gross * pct) / 100);
    } else {
      lineDiscountAmount = Math.min(gross, round2(discVal));
    }

    const netAfterLine = Math.max(0, round2(gross - lineDiscountAmount));
    grossSubtotal = round2(grossSubtotal + gross);
    lineDiscountTotal = round2(lineDiscountTotal + lineDiscountAmount);

    return {
      line,
      gross,
      lineDiscountAmount,
      netAfterLine,
    };
  });

  const totalAfterLineDiscounts = round2(
    intermediateLines.reduce((sum, item) => sum + item.netAfterLine, 0),
  );

  // Bill discount
  let billDiscountTotal = 0;
  if (billDiscount && totalAfterLineDiscounts > 0) {
    const bType = billDiscount.type ?? "%";
    const bVal = Math.max(0, billDiscount.value ?? 0);
    if (bType === "%") {
      const pct = Math.min(100, bVal);
      billDiscountTotal = round2((totalAfterLineDiscounts * pct) / 100);
    } else {
      billDiscountTotal = Math.min(totalAfterLineDiscounts, round2(bVal));
    }
  }

  // Second pass: apportion bill discount proportionally across items
  let distributedBillDiscount = 0;
  const computedLines: ComputedDiscountLine[] = intermediateLines.map((item) => {
    let billShare = 0;
    if (totalAfterLineDiscounts > 0 && billDiscountTotal > 0) {
      billShare = round2((item.netAfterLine / totalAfterLineDiscounts) * billDiscountTotal);
      distributedBillDiscount = round2(distributedBillDiscount + billShare);
    }

    const totalDiscountAmount = round2(item.lineDiscountAmount + billShare);
    const netTotal = round2(Math.max(0, item.gross - totalDiscountAmount));
    const effectiveDiscountPercent = item.gross > 0
      ? round2(Math.min(100, Math.max(0, (totalDiscountAmount / item.gross) * 100)))
      : 0;

    const gstRate = item.line.gstRate ?? 0;
    let taxableValue = netTotal;
    let cgst = 0;
    let sgst = 0;
    if (mode === "GST" && gstRate > 0) {
      taxableValue = round2(netTotal / (1 + gstRate / 100));
      const tax = round2(netTotal - taxableValue);
      cgst = round2(tax / 2);
      sgst = round2(tax / 2);
    }

    return {
      gross: item.gross,
      lineDiscountAmount: item.lineDiscountAmount,
      billDiscountAmount: billShare,
      totalDiscountAmount,
      effectiveDiscountPercent,
      netTotal,
      taxableValue,
      cgst,
      sgst,
    };
  });

  // Adjust any 1-2 paise residual between distributedBillDiscount and billDiscountTotal
  const residual = round2(billDiscountTotal - distributedBillDiscount);
  if (residual !== 0 && computedLines.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < computedLines.length; i++) {
      if (computedLines[i].netTotal > computedLines[maxIdx].netTotal) {
        maxIdx = i;
      }
    }
    const target = computedLines[maxIdx];
    target.billDiscountAmount = round2(target.billDiscountAmount + residual);
    target.totalDiscountAmount = round2(target.lineDiscountAmount + target.billDiscountAmount);
    target.netTotal = round2(Math.max(0, target.gross - target.totalDiscountAmount));
    target.effectiveDiscountPercent = target.gross > 0
      ? round2(Math.min(100, Math.max(0, (target.totalDiscountAmount / target.gross) * 100)))
      : 0;

    const gstRate = lines[maxIdx].gstRate ?? 0;
    if (mode === "GST" && gstRate > 0) {
      target.taxableValue = round2(target.netTotal / (1 + gstRate / 100));
      const tax = round2(target.netTotal - target.taxableValue);
      target.cgst = round2(tax / 2);
      target.sgst = round2(tax / 2);
    } else {
      target.taxableValue = target.netTotal;
      target.cgst = 0;
      target.sgst = 0;
    }
  }

  const totalDiscount = round2(lineDiscountTotal + billDiscountTotal);
  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let totalBeforeRound = 0;

  for (const line of computedLines) {
    taxableTotal = round2(taxableTotal + line.taxableValue);
    cgstTotal = round2(cgstTotal + line.cgst);
    sgstTotal = round2(sgstTotal + line.sgst);
    totalBeforeRound = round2(totalBeforeRound + line.netTotal);
  }

  const roundOff =
    typeof manualRoundOff === "number" && !isNaN(manualRoundOff)
      ? round2(manualRoundOff)
      : round2(Math.round(totalBeforeRound) - totalBeforeRound);
  const totalAmount = round2(totalBeforeRound + roundOff);

  return {
    lines: computedLines,
    grossSubtotal,
    lineDiscountTotal,
    billDiscountTotal,
    totalDiscount,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    roundOff,
    totalAmount,
  };
}

export function tidyDiscountOnBlur(raw: string, type: DiscountType, maxAmount = 100): string {
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0) return "0";
  if (type === "%") {
    return String(Math.min(100, Math.round(val * 100) / 100));
  }
  return String(Math.min(maxAmount, Math.round(val * 100) / 100));
}
