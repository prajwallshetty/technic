import "server-only";

import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

import { amountInWords } from "@/lib/money";
import type { BranchProfile } from "./pdf-builder";
import type { CompanyProfile } from "./types";

/**
 * Technic Technologies sales-document layout — the bordered, form-style
 * A4 Tax Invoice / Invoice / Quotation. One renderer for all three so the
 * documents look identical. Nothing is hardcoded: every value comes from
 * the `SalesDocData` the caller builds from the saved record.
 *
 * Page structure (top to bottom):
 *   title bar → company + invoice details → To / dispatch & e-way →
 *   items table → [amount in words + HSN tax summary | totals] →
 *   [bank details + terms | authorised signatory]
 */

const FONT = "DejaVuSans";
const FONT_BOLD = "DejaVuSans-Bold";

const C = {
  ink: "#111111",
  muted: "#4a4a4a",
  line: "#6b7280",
  light: "#cfd4d9",
  head: "#123524",
  headText: "#ffffff",
  tint: "#eef2ef",
  accent: "#e31e2d",
};

export interface SalesDocLine {
  name: string;
  subName?: string | null;
  serials?: string[];
  hsn?: string | null;
  quantity: number;
  /** Unit rate shown in the table (ex-tax on GST documents). */
  rate: number;
  discountPercent: number;
  taxable: number;
  netTaxable?: number;
  gstRate: number;
  amount: number;
}

export interface SalesDocTotals {
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  received?: number;
  due?: number;
}

export interface SalesDocData {
  title: string;
  /** Small caption under the title, e.g. "ORIGINAL FOR RECIPIENT". */
  titleNote?: string;
  isGst: boolean;
  company: CompanyProfile & { state?: string | null };
  branch: BranchProfile;
  meta: [string, string][];
  toHeading?: string;
  to: { name: string; lines: string[] };
  sideHeading: string;
  side: [string, string][];
  lines: SalesDocLine[];
  totals: SalesDocTotals;
  totalLabel: string;
  bankDetails?: string;
  terms?: string;
  signatoryFor: string;
  preparedBy?: string | null;
  notes?: string | null;
  discountRemarks?: string | null;
  showLineDiscount?: boolean;
  cancelledReason?: string | null;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 24; // page margin == outer border inset
const W = A4.w - M * 2;
const PAD = 5;

const nf = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: number) => nf.format(Math.round((v + Number.EPSILON) * 100) / 100);
const rupees = (v: number) => `₹ ${money(v)}`;

type Doc = InstanceType<typeof PDFDocument>;

interface TextOpts {
  w: number;
  size?: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  lineBreak?: boolean;
}

function heightOf(doc: Doc, value: string, o: TextOpts): number {
  return doc.font(o.bold ? FONT_BOLD : FONT).fontSize(o.size ?? 8.5).heightOfString(value, { width: o.w, align: o.align });
}

function put(doc: Doc, value: string, x: number, y: number, o: TextOpts): number {
  doc
    .font(o.bold ? FONT_BOLD : FONT)
    .fontSize(o.size ?? 8.5)
    .fillColor(o.color ?? C.ink)
    .text(value, x, y, { width: o.w, align: o.align, lineBreak: o.lineBreak ?? true });
  return heightOf(doc, value, o);
}

function rect(doc: Doc, x: number, y: number, w: number, h: number, color = C.line, lw = 0.7) {
  doc.lineWidth(lw).strokeColor(color).rect(x, y, w, h).stroke();
}

function hline(doc: Doc, x1: number, x2: number, y: number, color = C.line, lw = 0.7) {
  doc.lineWidth(lw).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke();
}

function vline(doc: Doc, x: number, y1: number, y2: number, color = C.line, lw = 0.7) {
  doc.lineWidth(lw).strokeColor(color).moveTo(x, y1).lineTo(x, y2).stroke();
}

// ---------------------------------------------------------------------------
// Items table
// ---------------------------------------------------------------------------

interface Col {
  id: string;
  header: string;
  frac: number;
  align: "left" | "center" | "right";
}

function columnsFor(isGst: boolean, showLineDiscount = false): Col[] {
  return isGst
    ? showLineDiscount
      ? [
          { id: "sl", header: "Sl", frac: 0.045, align: "center" },
          { id: "desc", header: "Description of Goods", frac: 0.295, align: "left" },
          { id: "hsn", header: "HSN", frac: 0.09, align: "center" },
          { id: "qty", header: "Qty", frac: 0.06, align: "center" },
          { id: "rate", header: "Rate (₹)", frac: 0.115, align: "right" },
          { id: "disc", header: "Disc %", frac: 0.06, align: "center" },
          { id: "taxable", header: "Taxable Value (₹)", frac: 0.13, align: "right" },
          { id: "gst", header: "GST %", frac: 0.055, align: "center" },
          { id: "amount", header: "Amount (₹)", frac: 0.15, align: "right" },
        ]
      : [
          { id: "sl", header: "Sl", frac: 0.045, align: "center" },
          { id: "desc", header: "Description of Goods", frac: 0.355, align: "left" },
          { id: "hsn", header: "HSN", frac: 0.09, align: "center" },
          { id: "qty", header: "Qty", frac: 0.06, align: "center" },
          { id: "rate", header: "Rate (₹)", frac: 0.115, align: "right" },
          { id: "taxable", header: "Taxable Value (₹)", frac: 0.13, align: "right" },
          { id: "gst", header: "GST %", frac: 0.055, align: "center" },
          { id: "amount", header: "Amount (₹)", frac: 0.15, align: "right" },
        ]
    : showLineDiscount
      ? [
          { id: "sl", header: "Sl", frac: 0.06, align: "center" },
          { id: "desc", header: "Description of Goods", frac: 0.47, align: "left" },
          { id: "qty", header: "Qty", frac: 0.09, align: "center" },
          { id: "rate", header: "Rate (₹)", frac: 0.14, align: "right" },
          { id: "disc", header: "Disc %", frac: 0.08, align: "center" },
          { id: "amount", header: "Amount (₹)", frac: 0.16, align: "right" },
        ]
      : [
          { id: "sl", header: "Sl", frac: 0.06, align: "center" },
          { id: "desc", header: "Description of Goods", frac: 0.55, align: "left" },
          { id: "qty", header: "Qty", frac: 0.09, align: "center" },
          { id: "rate", header: "Rate (₹)", frac: 0.14, align: "right" },
          { id: "amount", header: "Amount (₹)", frac: 0.16, align: "right" },
        ];
}

function cellValue(col: Col, line: SalesDocLine, index: number): string {
  switch (col.id) {
    case "sl": return String(index + 1);
    case "hsn": return line.hsn || "—";
    case "qty": return String(line.quantity);
    case "rate": return money(line.rate);
    case "disc": return line.discountPercent ? `${line.discountPercent}%` : "—";
    case "taxable": return money(line.taxable);
    case "gst": return `${line.gstRate}%`;
    case "amount": return money(line.amount);
    default: return "";
  }
}

function descHeight(doc: Doc, line: SalesDocLine, w: number): number {
  let h = heightOf(doc, line.name, { w, size: 8.5, bold: true });
  if (line.subName) h += heightOf(doc, line.subName, { w, size: 7.5 });
  if (line.serials?.length) h += heightOf(doc, `SN: ${line.serials.join(", ")}`, { w, size: 7 });
  return h;
}

// ---------------------------------------------------------------------------
// Footer blocks (measured first, then drawn)
// ---------------------------------------------------------------------------

interface HsnRow { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }

function hsnSummary(data: SalesDocData): HsnRow[] {
  const map = new Map<string, HsnRow>();
  const interState = data.totals.igst > 0;
  for (const l of data.lines) {
    const key = `${l.hsn ?? ""}|${l.gstRate}`;
    const row = map.get(key) ?? { hsn: l.hsn || "—", rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    const taxableVal = l.netTaxable !== undefined ? l.netTaxable : l.taxable;
    const tax = (taxableVal * l.gstRate) / 100;
    row.taxable += taxableVal;
    if (interState) row.igst += tax;
    else {
      row.cgst += tax / 2;
      row.sgst += tax / 2;
    }
    map.set(key, row);
  }
  return [...map.values()];
}

/** Draws (or just measures, when `draw` is false) everything below the item table. */
function footer(doc: Doc, data: SalesDocData, y: number, draw: boolean): number {
  const t = data.totals;
  const leftW = W * 0.6;
  const rightW = W - leftW;
  const rx = M + leftW;

  // --- Row A: words + HSN summary | totals ----------------------------------
  const words = amountInWords(t.total);
  const wordsH = heightOf(doc, words, { w: leftW - PAD * 2, size: 8.5, bold: true });

  const interState = t.igst > 0;
  const hsnRows = data.isGst ? hsnSummary(data) : [];
  const hsnCols = interState
    ? ["HSN", "Taxable (₹)", "IGST %", "IGST (₹)", "Total Tax (₹)"]
    : ["HSN", "Taxable (₹)", "CGST %", "CGST (₹)", "SGST %", "SGST (₹)", "Total Tax (₹)"];
  const hsnRowH = 14;
  const hsnH = data.isGst ? 12 + hsnRowH * (hsnRows.length + 2) + 4 : 0;
  const leftA = 6 + 11 + wordsH + 8 + hsnH;

  interface TotalsLine {
    label: string;
    value: string;
    subText?: string;
    strong?: boolean;
    head?: boolean;
  }
  const lines: TotalsLine[] = [];
  lines.push({ label: "Gross Amount", value: rupees(t.gross) });
  if (t.discount > 0) {
    lines.push({
      label: "Less: Discount",
      value: `- ${rupees(t.discount)}`,
      subText: data.discountRemarks?.trim() ? `Reason: ${data.discountRemarks.trim()}` : undefined,
    });
  }
  if (data.isGst) {
    lines.push({ label: "Taxable Value", value: rupees(t.taxable) });
    if (t.cgst > 0) lines.push({ label: "CGST", value: rupees(t.cgst) });
    if (t.sgst > 0) lines.push({ label: "SGST", value: rupees(t.sgst) });
    if (t.igst > 0) lines.push({ label: "IGST", value: rupees(t.igst) });
  }
  if (t.roundOff !== 0) lines.push({ label: "Round Off", value: `${t.roundOff < 0 ? "- " : ""}${rupees(Math.abs(t.roundOff))}` });
  const lineH = 16;
  const totalH = 24;
  const extra: typeof lines = [];
  if (t.received !== undefined) extra.push({ label: "Amount Received", value: rupees(t.received) });
  if (t.due !== undefined) extra.push({ label: "Balance Due", value: rupees(t.due), strong: true });
  const valW = rightW - PAD * 2;
  const measureLineH = (l: TotalsLine) => {
    let h = lineH;
    if (l.subText) {
      h += heightOf(doc, l.subText, { w: valW, size: 7.5 }) + 3;
    }
    return h;
  };
  const rightA = 4 + lines.reduce((s, l) => s + measureLineH(l), 0) + totalH + extra.reduce((s, l) => s + measureLineH(l), 0) + 4;
  const hA = Math.max(leftA, rightA, 60);

  // --- Row B: bank + terms | signatory --------------------------------------
  const bank = data.bankDetails?.trim();
  const terms = data.terms?.trim();
  const bankH = bank ? 11 + heightOf(doc, bank, { w: leftW - PAD * 2, size: 8 }) + 8 : 0;
  const termsH = terms ? 11 + heightOf(doc, terms, { w: leftW - PAD * 2, size: 7.5 }) + 8 : 0;
  const notesH = data.notes?.trim() ? 11 + heightOf(doc, data.notes.trim(), { w: leftW - PAD * 2, size: 8 }) + 8 : 0;
  const leftB = Math.max(bankH + termsH + notesH + 6, 70);
  const hB = Math.max(leftB, 96);

  if (!draw) return hA + hB;

  // Row A
  rect(doc, M, y, W, hA);
  vline(doc, rx, y, y + hA);
  let ly = y + 6;
  put(doc, "Amount in Words", M + PAD, ly, { w: leftW - PAD * 2, size: 7.5, color: C.muted });
  ly += 11;
  ly += put(doc, words, M + PAD, ly, { w: leftW - PAD * 2, size: 8.5, bold: true }) + 8;

  if (data.isGst) {
    const gx = M + PAD;
    const gw = leftW - PAD * 2;
    put(doc, "Tax Summary", gx, ly, { w: gw, size: 7.5, color: C.muted });
    ly += 12;
    const hsnFractions = interState
      ? [0.13, 0.27, 0.12, 0.24, 0.24]
      : [0.11, 0.23, 0.09, 0.145, 0.09, 0.145, 0.19];
    const widths = hsnFractions.map((f) => f * gw);
    doc.rect(gx, ly, gw, hsnRowH).fill(C.tint);
    let cx = gx;
    hsnCols.forEach((h, i) => {
      put(doc, h, cx + 1, ly + 3.5, { w: widths[i] - 2, size: 6, bold: true, align: i === 0 ? "left" : "right", lineBreak: false });
      cx += widths[i];
    });
    ly += hsnRowH;
    const writeRow = (cells: string[], bold = false) => {
      let x = gx;
      cells.forEach((c, i) => {
        put(doc, c, x + 1, ly + 3.5, { w: widths[i] - 2, size: 6, bold, align: i === 0 ? "left" : "right", lineBreak: false });
        x += widths[i];
      });
      hline(doc, gx, gx + gw, ly + hsnRowH, C.light, 0.4);
      ly += hsnRowH;
    };
    for (const r of hsnRows) {
      writeRow(
        interState
          ? [r.hsn, money(r.taxable), `${r.rate}%`, money(r.igst), money(r.igst)]
          : [r.hsn, money(r.taxable), `${r.rate / 2}%`, money(r.cgst), `${r.rate / 2}%`, money(r.sgst), money(r.cgst + r.sgst)],
      );
    }
    const sumTaxable = hsnRows.reduce((s, r) => s + r.taxable, 0);
    writeRow(
      interState
        ? ["Total", money(sumTaxable), "", money(t.igst), money(t.igst)]
        : ["Total", money(sumTaxable), "", money(t.cgst), "", money(t.sgst), money(t.cgst + t.sgst)],
      true,
    );
  }

  let ry = y + 4;
  const valX = rx + PAD;
  for (const l of lines) {
    put(doc, l.label, valX, ry + 3, { w: valW, size: 8.5 });
    put(doc, l.value, valX, ry + 3, { w: valW, size: 8.5, align: "right" });
    ry += lineH;
    if (l.subText) {
      const subH = put(doc, l.subText, valX, ry, { w: valW, size: 7.5, color: C.muted });
      ry += subH + 3;
    }
  }
  doc.rect(rx, ry, rightW, totalH).fill(C.head);
  put(doc, data.totalLabel, valX, ry + 7, { w: valW, size: 8.5, bold: true, color: C.headText });
  put(doc, rupees(t.total), valX, ry + 6, { w: valW, size: 10.5, bold: true, color: C.headText, align: "right" });
  ry += totalH;
  for (const l of extra) {
    put(doc, l.label, valX, ry + 3, { w: valW, size: 8.5, bold: l.strong });
    put(doc, l.value, valX, ry + 3, { w: valW, size: 8.5, bold: l.strong, align: "right" });
    ry += lineH;
  }

  // Row B
  const yb = y + hA;
  rect(doc, M, yb, W, hB);
  vline(doc, rx, yb, yb + hB);
  let by = yb + 6;
  if (bank) {
    put(doc, "Bank Details", M + PAD, by, { w: leftW - PAD * 2, size: 7.5, bold: true });
    by += 11;
    by += put(doc, bank, M + PAD, by, { w: leftW - PAD * 2, size: 8 }) + 8;
  }
  if (terms) {
    put(doc, "Terms & Conditions", M + PAD, by, { w: leftW - PAD * 2, size: 7.5, bold: true });
    by += 11;
    by += put(doc, terms, M + PAD, by, { w: leftW - PAD * 2, size: 7.5, color: C.muted }) + 8;
  }
  if (data.notes?.trim()) {
    put(doc, "Notes", M + PAD, by, { w: leftW - PAD * 2, size: 7.5, bold: true });
    by += 11;
    put(doc, data.notes.trim(), M + PAD, by, { w: leftW - PAD * 2, size: 8 });
  }

  put(doc, `For ${data.signatoryFor}`, rx + PAD, yb + 6, { w: rightW - PAD * 2, size: 8.5, bold: true, align: "center" });
  hline(doc, rx + 24, rx + rightW - 24, yb + hB - 26, C.line, 0.7);
  put(doc, "Authorised Signatory", rx + PAD, yb + hB - 20, { w: rightW - PAD * 2, size: 8, bold: true, align: "center" });
  if (data.preparedBy) {
    put(doc, `Prepared by: ${data.preparedBy}`, rx + PAD, yb + hB - 10, { w: rightW - PAD * 2, size: 6.5, color: C.muted, align: "center" });
  }
  return hA + hB;
}

// ---------------------------------------------------------------------------
// Header blocks
// ---------------------------------------------------------------------------

function kvBlock(doc: Doc, pairs: [string, string][], x: number, y: number, w: number, draw: boolean): number {
  const labelW = w * 0.42;
  let h = 0;
  for (const [label, value] of pairs) {
    const vh = heightOf(doc, value || "—", { w: w - labelW - 4, size: 8, bold: true });
    if (draw) {
      put(doc, label, x, y + h, { w: labelW, size: 8, color: C.muted });
      put(doc, value || "—", x + labelW, y + h, { w: w - labelW - 4, size: 8, bold: true });
    }
    h += Math.max(vh, 10) + 3;
  }
  return h;
}

function drawFirstHeader(doc: Doc, data: SalesDocData): number {
  let y = M;
  const leftW = W * 0.6;
  const rightW = W - leftW;
  const rx = M + leftW;

  // Title bar
  const titleH = 24;
  doc.rect(M, y, W, titleH).fill(C.head);
  put(doc, data.title, M, y + 6, { w: W, size: 12.5, bold: true, color: C.headText, align: "center" });
  if (data.titleNote) {
    put(doc, data.titleNote, M + W - 150, y + 9, { w: 144, size: 6.5, color: "#c9d6cf", align: "right" });
  }
  y += titleH;

  // Company | invoice details
  const c = data.company;
  const logoPath = ["logo-pdf.png", "logo.png"].map((f) => path.join(process.cwd(), "public", f)).find((p) => fs.existsSync(p));
  const logoW = 92;
  const hasLogo = Boolean(logoPath);
  const textX = M + PAD + (hasLogo ? logoW + 8 : 0);
  const textW = leftW - PAD * 2 - (hasLogo ? logoW + 8 : 0);

  const addr = [c.address || [data.branch.addressLine, data.branch.city, data.branch.state, data.branch.pincode].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("");
  const contact = [
    data.branch.phone || c.phone ? `Ph: ${data.branch.phone || c.phone}` : "",
    data.branch.email || c.email ? `Email: ${data.branch.email || c.email}` : "",
  ].filter(Boolean).join("   ");
  const reg = [c.gstin ? `GSTIN: ${c.gstin}` : "", c.state ? `State: ${c.state}` : "", c.pan ? `PAN: ${c.pan}` : ""].filter(Boolean).join("   ");

  const nameH = heightOf(doc, c.name, { w: textW, size: 13, bold: true });
  const leftH = 6 + nameH + 3 +
    (addr ? heightOf(doc, addr, { w: textW, size: 8 }) + 2 : 0) +
    (contact ? heightOf(doc, contact, { w: textW, size: 8 }) + 2 : 0) +
    (reg ? heightOf(doc, reg, { w: textW, size: 8, bold: true }) + 2 : 0) + 6;
  const metaH = 8 + kvBlock(doc, data.meta, 0, 0, rightW - PAD * 2, false) + 4;
  const rowH = Math.max(leftH, metaH, 64);

  rect(doc, M, y, W, rowH);
  vline(doc, rx, y, y + rowH);
  if (logoPath) {
    try { doc.image(logoPath, M + PAD, y + 8, { fit: [logoW, 40] }); } catch { /* keep rendering without the logo */ }
  }
  let ty = y + 6;
  ty += put(doc, c.name, textX, ty, { w: textW, size: 13, bold: true, color: C.head }) + 3;
  if (addr) ty += put(doc, addr, textX, ty, { w: textW, size: 8, color: C.muted }) + 2;
  if (contact) ty += put(doc, contact, textX, ty, { w: textW, size: 8, color: C.muted }) + 2;
  if (reg) put(doc, reg, textX, ty, { w: textW, size: 8, bold: true });
  kvBlock(doc, data.meta, rx + PAD, y + 8, rightW - PAD * 2, true);
  y += rowH;

  // To | dispatch / e-way
  const toLines = data.to.lines;
  const toText = [data.to.name, ...toLines];
  const toH = 6 + 11 +
    heightOf(doc, data.to.name, { w: leftW - PAD * 2, size: 9.5, bold: true }) + 2 +
    toLines.reduce((s, l) => s + heightOf(doc, l, { w: leftW - PAD * 2, size: 8 }) + 1, 0) + 6;
  void toText;
  const sideH = 6 + 11 + kvBlock(doc, data.side, 0, 0, rightW - PAD * 2, false) + 4;
  const rowH2 = Math.max(toH, sideH, 56);

  rect(doc, M, y, W, rowH2);
  vline(doc, rx, y, y + rowH2);
  put(doc, data.toHeading ?? "To", M + PAD, y + 6, { w: leftW - PAD * 2, size: 7.5, color: C.muted });
  let toY = y + 17;
  toY += put(doc, data.to.name, M + PAD, toY, { w: leftW - PAD * 2, size: 9.5, bold: true }) + 2;
  for (const l of toLines) toY += put(doc, l, M + PAD, toY, { w: leftW - PAD * 2, size: 8 }) + 1;
  put(doc, data.sideHeading, rx + PAD, y + 6, { w: rightW - PAD * 2, size: 7.5, color: C.muted });
  kvBlock(doc, data.side, rx + PAD, y + 17, rightW - PAD * 2, true);
  y += rowH2;

  return y;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function renderSalesDocument(data: SalesDocData, title: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0, // all positions are explicit; no implicit page breaks
    bufferPages: true,
    info: { Title: title, Author: data.company.name, Creator: "Technic Technologies ERP" },
  });
  doc.registerFont(FONT, path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"));
  doc.registerFont(FONT_BOLD, path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"));

  const cols = columnsFor(data.isGst, data.showLineDiscount ?? false);
  const widths = cols.map((c) => c.frac * W);
  const descIdx = cols.findIndex((c) => c.id === "desc");
  const descW = widths[descIdx] - PAD * 2;
  const headH = 24;
  const maxY = A4.h - M - 14; // keeps room for the page-number line

  const drawTableHeader = (y: number) => {
    doc.rect(M, y, W, headH).fill(C.head);
    let x = M;
    cols.forEach((col, i) => {
      put(doc, col.header, x + 2, y + (col.header.length > 12 ? 4 : 8), { w: widths[i] - 4, size: 7, bold: true, color: C.headText, align: col.align === "left" ? "left" : "center" });
      x += widths[i];
    });
    return y + headH;
  };

  const drawColumnRules = (from: number, to: number) => {
    let x = M;
    for (let i = 0; i < cols.length - 1; i++) {
      x += widths[i];
      vline(doc, x, from, to, C.light, 0.5);
    }
    rect(doc, M, from, W, to - from);
  };

  let y = drawFirstHeader(doc, data);
  const footerH = footer(doc, data, 0, false);

  y = drawTableHeader(y);
  let bodyStart = y;
  const continuationHeader = () => {
    drawColumnRules(bodyStart, y);
    doc.addPage();
    let ny = M;
    put(doc, `${data.title} — ${data.meta[0]?.[1] ?? ""} (continued)`, M, ny + 2, { w: W, size: 9, bold: true });
    ny += 18;
    ny = drawTableHeader(ny);
    bodyStart = ny;
    return ny;
  };

  data.lines.forEach((line, index) => {
    const h = Math.max(descHeight(doc, line, descW) + 8, 20);
    if (y + h > maxY - 40) y = continuationHeader();

    let x = M;
    cols.forEach((col, i) => {
      if (col.id === "desc") {
        let dy = y + 4;
        dy += put(doc, line.name, x + PAD, dy, { w: descW, size: 8.5, bold: true });
        if (line.subName) dy += put(doc, line.subName, x + PAD, dy, { w: descW, size: 7.5, color: C.muted });
        if (line.serials?.length) put(doc, `SN: ${line.serials.join(", ")}`, x + PAD, dy, { w: descW, size: 7, color: C.muted });
      } else {
        put(doc, cellValue(col, line, index), x + 2, y + 4, { w: widths[i] - 4 - (col.align === "right" ? 2 : 0), size: 8.5, align: col.align });
      }
      x += widths[i];
    });
    hline(doc, M, M + W, y + h, C.light, 0.4);
    y += h;
  });

  // Fill the empty part of the item area so the form reads like a printed invoice.
  const totalQty = data.lines.reduce((s, l) => s + l.quantity, 0);
  const totalRowH = 18;
  let tableEnd: number;
  if (y + totalRowH + footerH <= maxY) {
    tableEnd = Math.max(y, maxY - footerH - totalRowH);
  } else {
    tableEnd = y;
  }
  drawColumnRules(bodyStart, tableEnd);
  y = tableEnd;

  // Totals row
  if (y + totalRowH + footerH > maxY) {
    doc.addPage();
    y = M;
  }
  doc.rect(M, y, W, totalRowH).fill(C.tint);
  rect(doc, M, y, W, totalRowH);
  let tx = M;
  cols.forEach((col, i) => {
    if (col.id === "desc") put(doc, "Total", tx + PAD, y + 5, { w: widths[i] - PAD * 2, size: 8.5, bold: true, align: "right" });
    if (col.id === "qty") put(doc, String(totalQty), tx + 2, y + 5, { w: widths[i] - 4, size: 8.5, bold: true, align: "center" });
    if (col.id === "taxable") put(doc, money(data.lines.reduce((s, l) => s + l.taxable, 0)), tx + 2, y + 5, { w: widths[i] - 6, size: 8.5, bold: true, align: "right" });
    if (col.id === "amount") put(doc, money(data.lines.reduce((s, l) => s + l.amount, 0)), tx + 2, y + 5, { w: widths[i] - 6, size: 8.5, bold: true, align: "right" });
    tx += widths[i];
  });
  y += totalRowH;

  footer(doc, data, y, true);

  if (data.cancelledReason !== undefined && data.cancelledReason !== null) {
    doc.save();
    doc.opacity(0.16).font(FONT_BOLD).fontSize(56).fillColor(C.accent);
    doc.rotate(-30, { origin: [A4.w / 2, A4.h / 2] });
    doc.text("CANCELLED", A4.w / 2 - 180, A4.h / 2 - 30, { width: 360, align: "center", lineBreak: false });
    doc.restore();
    doc.opacity(1);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    // Outer frame on every page + page numbers + footer line.
    if (range.count > 1) {
      put(doc, `Page ${i + 1} of ${range.count}`, M, A4.h - M - 8, { w: W, size: 7, color: C.muted, align: "right" });
    }
    put(doc, "This is a computer-generated document.", M, A4.h - M - 8, { w: W, size: 7, color: C.muted, align: "left" });
  }

  doc.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
