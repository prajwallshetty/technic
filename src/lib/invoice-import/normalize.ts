/**
 * Parsing and normalisation helpers. None of these guess: a value that cannot
 * be read unambiguously comes back as null so the caller can flag it.
 */

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Parses an Indian/Western formatted amount: "27,250.09", " -0.11", "1,00,000".
 * Returns null for masked/overflowed cells such as "*****.**" — those must be
 * flagged, never treated as zero.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.replace(/\s+/g, "").replace(/^₹|^Rs\.?/i, "");
  if (!text || /\*/.test(text)) return null;
  if (!/^[-+(]?\d[\d,]*(\.\d+)?\)?$/.test(text)) return null;
  const negative = text.startsWith("-") || (text.startsWith("(") && text.endsWith(")"));
  const value = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function isMaskedNumber(raw: string | null | undefined): boolean {
  return Boolean(raw && /^\s*-?\*+(\.\*+)?\s*$/.test(raw));
}

/** "02/04/2026" (DD/MM/YYYY, also - and . separators) → "2026-04-02". */
export function parseIndianDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/;

/** Validates structure and the mod-36 check digit of an Indian GSTIN. */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const value = gstin.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARSET.indexOf(value[i]);
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARSET[(36 - (sum % 36)) % 36];
  return check === value[14];
}

/** Loose GSTIN finder — also catches typo'd ones so they can be flagged. */
export function findGstinCandidate(text: string): string | null {
  const m = text.toUpperCase().match(/\b\d{2}[A-Z0-9]{10}[0-9A-Z]{3}\b/);
  return m ? m[0] : null;
}

export function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!gstin || !/^\d{2}/.test(gstin)) return null;
  return gstin.slice(0, 2);
}

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = {
  hundred: 100, thousand: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000,
  crore: 10_000_000, crores: 10_000_000,
};

function wordsToInteger(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const word of words) {
    if (word in SMALL) {
      current += SMALL[word];
      seen = true;
    } else if (word === "hundred") {
      current = (current || 1) * 100;
      seen = true;
    } else if (word in SCALE) {
      total += (current || 1) * SCALE[word];
      current = 0;
      seen = true;
    } else if (word === "and") {
      continue;
    } else {
      return null;
    }
  }
  return seen ? total + current : null;
}

/**
 * "Rupees Thirty Two Thousand One Hundred Fifty Five only" → 32155.
 * Supports "... and Fifty Paise". Returns null if any word is unrecognised.
 */
export function parseAmountInWords(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\b(rupees?|rs|inr|only)\b/g, " ")
    .trim();
  if (!cleaned) return null;
  let rupeePart = cleaned;
  let paisePart: string | null = null;
  if (/\bpaise\b/.test(cleaned)) {
    const beforePaise = cleaned.split(/\bpaise\b/)[0];
    const lastAnd = beforePaise.lastIndexOf(" and ");
    if (lastAnd === -1) return null;
    rupeePart = beforePaise.slice(0, lastAnd);
    paisePart = beforePaise.slice(lastAnd + 5);
  }
  const rupees = wordsToInteger(rupeePart.split(/\s+/).filter(Boolean));
  if (rupees === null) return null;
  if (paisePart === null) return rupees;
  const paise = wordsToInteger(paisePart.split(/\s+/).filter(Boolean));
  return paise === null ? null : round2(rupees + paise / 100);
}

/** Uppercase, collapse every run of non-alphanumerics: "B2038B20R 35AH (WARRENTY 24+24)" → "B2038B20R35AHWARRENTY2424". */
export function compactKey(text: string | null | undefined): string {
  return (text ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** Uppercase words with punctuation turned into spaces — used for token comparisons. */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(text: string | null | undefined): string[] {
  const value = normalizeText(text);
  return value ? value.split(" ") : [];
}

/** Capacity/rating tokens ("100AH", "24LTR", "1HP", "4STAGE") describe a product but do not identify it. */
const UNIT_TOKEN = /^\d+(AH|V|W|KW|HP|KG|LTR|LITER|LITRE|L|MM|KVA|VA|STAGE|PCS|M)$/;

/**
 * Model-number–like tokens (contain both letters and digits, length ≥ 4):
 * "125E41L", "MTZ5LA", "B2038B20R". These identify battery/pump models far
 * more reliably than the surrounding marketing words.
 */
export function modelTokens(text: string | null | undefined): string[] {
  return tokens(text).filter(
    (token) =>
      token.length >= 4 &&
      /[A-Z]/.test(token) &&
      /\d/.test(token) &&
      !UNIT_TOKEN.test(token) &&
      !/^WARR?[AE]NT/.test(token),
  );
}

export function nearlyEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance + 1e-9;
}
