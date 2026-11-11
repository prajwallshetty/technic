import { stateCodeFromGstin } from "./masters";

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (values: number[]) => r2(values.reduce((a, b) => a + b, 0));

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export type GstinCheck = "OK" | "BAD_FORMAT" | "BAD_STATE" | "BAD_CHECK_DIGIT";

/** Structure, state code and mod-36 check digit of a GSTIN. */
export function checkGstin(gstin: string | null | undefined): GstinCheck {
  const g = (gstin ?? "").trim().toUpperCase();
  if (!GSTIN_SHAPE.test(g)) return "BAD_FORMAT";
  if (!stateCodeFromGstin(g)) return "BAD_STATE";
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (total % 36)) % 36] === g[14] ? "OK" : "BAD_CHECK_DIGIT";
}

/** Numbers compare numerically when they share a prefix ("9" before "10"). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** Splits "TT/GST/26-27/0012" into a series prefix and a trailing number. */
export function splitSeries(number: string): { prefix: string; seq: number | null; width: number } {
  const m = number.match(/^(.*?)(\d+)$/);
  if (!m) return { prefix: number, seq: null, width: 0 };
  return { prefix: m[1], seq: Number(m[2]), width: m[2].length };
}

export function monthRange(isoFrom: string, isoTo: string): { fromMonth: string; toMonth: string } {
  return { fromMonth: isoFrom.slice(0, 7), toMonth: isoTo.slice(0, 7) };
}
