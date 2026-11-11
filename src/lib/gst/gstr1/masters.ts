/**
 * Official GSTR-1 master data, copied from the hidden "master" sheet of the GST
 * portal's Returns Offline Tool (GSTR1_Excel_Workbook_Template_V2.2, tool
 * version 3.2.4). These are the only values the portal accepts, so they are
 * reproduced verbatim — including spellings such as "Lakshdweep".
 */

/** State / UT code → name, as listed for "Place Of Supply" (POS). */
export const STATES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli & Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshdweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

/** Place of supply for exports (the only code that is not a state). */
export const FOREIGN_POS = { code: "96", name: "Foreign Country" } as const;

/** "29" → "29-Karnataka"; null when the code is not an official POS. */
export function posLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === FOREIGN_POS.code) return `${FOREIGN_POS.code}-${FOREIGN_POS.name}`;
  const name = STATES[code];
  return name ? `${code}-${name}` : null;
}

export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return code === FOREIGN_POS.code ? FOREIGN_POS.name : (STATES[code] ?? null);
}

const NAME_TO_CODE = new Map<string, string>();
for (const [code, name] of Object.entries(STATES)) NAME_TO_CODE.set(normaliseName(name), code);
// Common spellings used in addresses; each maps to exactly one official state.
for (const [alias, code] of [
  ["Tamilnadu", "33"], ["Pondicherry", "34"], ["Orissa", "21"], ["Uttaranchal", "05"],
  ["Lakshadweep", "31"], ["Jammu and Kashmir", "01"], ["Delhi NCT", "07"], ["New Delhi", "07"],
  ["Andaman and Nicobar Islands", "35"], ["Dadra and Nagar Haveli", "26"], ["Daman and Diu", "25"],
] as const) NAME_TO_CODE.set(normaliseName(alias), code);

function normaliseName(name: string) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z]+/g, " ").trim();
}

/** Official POS code for a state name, or null if the name is not recognised. */
export function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const direct = NAME_TO_CODE.get(normaliseName(name));
  if (direct) return direct;
  // "29-Karnataka" or "29"
  const m = name.trim().match(/^(\d{2})(?:\s*-\s*.*)?$/);
  if (m && (STATES[m[1]] || m[1] === FOREIGN_POS.code)) return m[1];
  return null;
}

/** First two digits of a GSTIN, when they are an official state code. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const code = gstin?.trim().slice(0, 2);
  return code && STATES[code] ? code : null;
}

/** Unit Quantity Codes accepted by the portal (code-NAME). */
export const UQC_LIST = [
  "BAG-BAGS", "BAL-BALE", "BDL-BUNDLES", "BKL-BUCKLES", "BOU-BILLION OF UNITS", "BOX-BOX", "BTL-BOTTLES",
  "BUN-BUNCHES", "CAN-CANS", "CBM-CUBIC METERS", "CCM-CUBIC CENTIMETERS", "CMS-CENTIMETERS", "CTN-CARTONS",
  "DOZ-DOZENS", "DRM-DRUMS", "GGK-GREAT GROSS", "GMS-GRAMMES", "GRS-GROSS", "GYD-GROSS YARDS", "KGS-KILOGRAMS",
  "KLR-KILOLITRE", "KME-KILOMETRE", "LTR-LITRES", "MLT-MILILITRE", "MTR-METERS", "MTS-METRIC TON", "NOS-NUMBERS",
  "PAC-PACKS", "PCS-PIECES", "PRS-PAIRS", "QTL-QUINTAL", "ROL-ROLLS", "SET-SETS", "SQF-SQUARE FEET",
  "SQM-SQUARE METERS", "SQY-SQUARE YARDS", "TBS-TABLETS", "TGM-TEN GROSS", "THD-THOUSANDS", "TON-TONNES",
  "TUB-TUBES", "UGS-US GALLONS", "UNT-UNITS", "YDS-YARDS", "OTH-OTHERS",
] as const;

const UQC_BY_CODE = new Map<string, string>(UQC_LIST.map((u) => [u.split("-")[0], u]));

/** "PCS" / "pcs" / "PCS-PIECES" → "PCS-PIECES"; null if not an official UQC. */
export function normaliseUqc(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  return UQC_BY_CODE.get(v.split("-")[0]) ?? null;
}

/** Tax rates the portal accepts (percent). 40% was added in offline tool 3.2.3. */
export const TAX_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40] as const;
export const isValidRate = (rate: number) => TAX_RATES.some((r) => Math.abs(r - rate) < 1e-9);

/** "Invoice Type" values of the b2b sheet, by supply type. */
export const B2B_INVOICE_TYPE = {
  REGULAR: "Regular B2B",
  SEZ_WITH_PAYMENT: "SEZ supplies with payment",
  SEZ_WITHOUT_PAYMENT: "SEZ supplies without payment",
  DEEMED_EXPORT: "Deemed Exp",
} as const;

/** Invoice-type code used in the portal JSON. */
export const JSON_INVOICE_TYPE = {
  REGULAR: "R",
  SEZ_WITH_PAYMENT: "SEWP",
  SEZ_WITHOUT_PAYMENT: "SEWOP",
  DEEMED_EXPORT: "DE",
} as const;

/** Table 13 document natures and their JSON `doc_num` codes. */
export const DOC_NATURES = [
  { code: 1, name: "Invoices for outward supply" },
  { code: 2, name: "Invoices for inward supply from unregistered person" },
  { code: 3, name: "Revised Invoice" },
  { code: 4, name: "Debit Note" },
  { code: 5, name: "Credit Note" },
  { code: 6, name: "Receipt Voucher" },
  { code: 7, name: "Payment Voucher" },
  { code: 8, name: "Refund Voucher" },
  { code: 9, name: "Delivery Challan for job work" },
  { code: 10, name: "Delivery Challan for supply on approval" },
  { code: 11, name: "Delivery Challan in case of liquid gas" },
  { code: 12, name: "Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)" },
] as const;

/** Table 8 categories (exemp sheet), in the order the portal lists them. */
export const EXEMP_CATEGORIES = [
  { key: "INTER_REG", label: "Inter-State supplies to registered persons", json: "INTRB2B" },
  { key: "INTRA_REG", label: "Intra-State supplies to registered persons", json: "INTRAB2B" },
  { key: "INTER_UNREG", label: "Inter-State supplies to unregistered persons", json: "INTRB2C" },
  { key: "INTRA_UNREG", label: "Intra-State supplies to unregistered persons", json: "INTRAB2C" },
] as const;

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** yyyy-mm-dd → "01-Sep-2026" (offline-tool sheets). */
export function fmtDateDMY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${MON3[Number(m) - 1]}-${y}`;
}
/** yyyy-mm-dd → "01/09/2026" (GSTR1 Report sheet). */
export function fmtDateSlash(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
/** yyyy-mm-dd → "01-09-2026" (portal JSON). */
export function fmtDateJson(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
