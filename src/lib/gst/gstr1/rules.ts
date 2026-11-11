import type { FirmGstProfile } from "./types";

/**
 * Period-dependent GST return rules. Every rule is keyed by the tax period so
 * nothing is hardcoded to a single date; each cites where it comes from.
 */
export interface PeriodRules {
  /** B2CL: inter-state supply to an unregistered person is B2CL when the invoice value exceeds this (₹). */
  b2clThreshold: number;
  /** Minimum HSN digits required in Table 12. */
  hsnMinDigits: number;
  /** Table 12 is reported separately for B2B and B2C supplies. */
  hsnSplit: boolean;
  /** True when the AATO band was not configured, so the HSN digits are only a floor. */
  hsnDigitsAssumed: boolean;
}

/**
 * Sources: GST Returns Offline Tool 3.2.4 release notes —
 *  - 3.2.1 "updated invoice limit for B2CL and B2CLA tables based on return
 *    period before and after Aug 2024" (₹2,50,000 before, ₹1,00,000 from Aug 2024;
 *    3.2.4 accepts values from 100000.01 / 250000.01 accordingly),
 *  - 3.2.2 "HSN is bifurcated into HSN(B2B) and HSN(B2C)" (return period May 2025 onwards,
 *    per the GST portal advisory on HSN validations in Table 12),
 *  - 3.1.6 minimum HSN length 6 digits for AATO above ₹5 crore, 4 digits otherwise.
 */
export function rulesFor(periodFrom: string, firm: Pick<FirmGstProfile, "aatoBand">): PeriodRules {
  const ym = periodFrom.slice(0, 7); // yyyy-mm
  const b2clThreshold = ym >= "2024-08" ? 100_000 : 250_000;
  const hsnSplit = ym >= "2025-05";
  const above = firm.aatoBand === "ABOVE_5CR";
  return {
    b2clThreshold,
    hsnMinDigits: above ? 6 : 4,
    hsnSplit,
    hsnDigitsAssumed: firm.aatoBand === null,
  };
}
