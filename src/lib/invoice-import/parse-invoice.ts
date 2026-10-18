import { groupLines, type TextLine } from "./pdf-text";
import {
  findGstinCandidate,
  gstinStateCode,
  isMaskedNumber,
  parseAmount,
  parseAmountInWords,
  parseIndianDate,
} from "./normalize";
import {
  emptyField,
  emptyParty,
  field,
  type DocumentText,
  type ExtractedInvoice,
  type ExtractedLine,
  type ExtractedTotals,
  type ExtractionIssue,
  type Field,
  type PartyDetails,
  type TaxRateSummaryRow,
  type TextItem,
} from "./types";

/**
 * Layout-driven invoice parser.
 *
 * Works from text positions, not fixed coordinates: the line-item columns are
 * derived from the header row ("Description", "Hsn", "Quantity", "Rate",
 * "Amount", ...) of each page, key/value fields are read to the right of their
 * labels, and totals are paired to their labels by vertical proximity. That
 * keeps it correct when a value overflows its cell, a description runs into
 * the HSN column, or a label and its value sit on slightly different
 * baselines — all of which occur in the real invoices.
 *
 * Anything it cannot read is left null with an issue attached; it never fills
 * in defaults (no assumed HSN, GST rate or quantity).
 */

const HIGH = 0.98;
const MEDIUM = 0.8;
const LOW = 0.5;

const DOC_TYPES = [
  "TAX INVOICE",
  "BILL OF SUPPLY",
  "RETAIL INVOICE",
  "CREDIT NOTE",
  "DEBIT NOTE",
  "PROFORMA INVOICE",
  "DELIVERY CHALLAN",
  "PURCHASE ORDER",
  "QUOTATION",
  "ESTIMATE",
  "INVOICE",
];

type ColumnKey = "sl" | "description" | "hsn" | "quantity" | "unit" | "gst" | "rate" | "discount" | "amount";

const COLUMN_PATTERNS: Array<[ColumnKey, RegExp]> = [
  ["sl", /^(sl|s\.?\s?no\.?|sr\.?(\s?no\.?)?|#)$/i],
  ["description", /description|particulars|item\s*name|product/i],
  ["hsn", /^(hsn|sac|hsn\/sac|hsn\s*code)$/i],
  ["quantity", /^(quantity|qty\.?)$/i],
  ["unit", /^(unit|uom|per)$/i],
  ["gst", /^(gst\s*%?|tax\s*%|gst\s*rate|igst\s*%)$/i],
  ["rate", /^(rate|price|unit\s*price)$/i],
  ["discount", /^(disc\.?\s*%?|discount)$/i],
  ["amount", /^(amount|total|value)$/i],
];

interface Column {
  key: ColumnKey;
  left: number;
  right: number;
  center: number;
}

interface PageLayout {
  page: number;
  headerY: number;
  columns: Column[];
  /** [lo, hi) boundaries keyed by column, by item centre. */
  bounds: Map<ColumnKey, [number, number]>;
}

export interface ParseContext {
  sourceFilename: string;
  /** The ERP firm's own GSTIN — decides whether this is a sales or purchase document. */
  firmGstin: string | null;
  firmName?: string | null;
}

export function parseInvoice(doc: DocumentText, ctx: ParseContext): ExtractedInvoice {
  const issues: ExtractionIssue[] = [];
  const allItems = doc.pages.flatMap((page) => page.items);
  const lines = groupLines(allItems);

  const result: ExtractedInvoice = {
    sourceFilename: ctx.sourceFilename,
    layoutId: "unrecognised",
    extractionMethod: doc.method,
    pageCount: doc.pageCount,
    documentType: emptyField(),
    direction: "UNKNOWN",
    issuer: emptyParty(),
    recipient: emptyParty(),
    invoiceNumber: emptyField(),
    invoiceDate: emptyField(),
    dueDate: emptyField(),
    paymentTerms: emptyField(),
    purchaseOrderNumber: emptyField(),
    referenceNumbers: [],
    dispatchThrough: emptyField(),
    ewayBillNumber: emptyField(),
    currency: emptyField(),
    placeOfSupply: emptyField(),
    lines: [],
    totals: emptyTotals(),
    issues,
    rawText: doc.plainText,
  };

  // ---- Document type -------------------------------------------------------
  const firstPageLines = lines.filter((l) => l.page === 1);
  for (const line of firstPageLines.slice(0, 12)) {
    const upper = line.text.toUpperCase();
    const type = DOC_TYPES.find((t) => upper.includes(t));
    if (type) {
      result.documentType = field(type, HIGH, line.text);
      break;
    }
  }

  // ---- Line-item layout per page ----------------------------------------
  const layouts = doc.pages
    .map((page) => detectLayout(lines.filter((l) => l.page === page.page), page.page))
    .filter((l): l is PageLayout => l !== null);

  const recipientLabelLine = firstPageLines.find((l) =>
    /^(to|bill\s*to|billed\s*to|buyer|consignee|ship\s*to|m\/s\.?)\b/i.test(l.items[0]?.str.trim() ?? ""),
  );
  const firstHeaderY = layouts.find((l) => l.page === 1)?.headerY ?? null;

  // The right-hand key/value block ("Invoice No. :", "Invoice Date :") starts
  // at the leftmost such label; everything left of it in the party block
  // belongs to the recipient address.
  const kvLabels = firstPageLines
    .flatMap((l) => l.items)
    .filter((i) => /^(invoice\s*(no|date|type)|despatched|dispatched|e\s*-?\s*way|due\s*date|buyer'?s?\s*order|p\.?o\.?\s*no)/i.test(i.str.trim()));
  const kvLeft = kvLabels.length ? Math.min(...kvLabels.map((i) => i.x)) : null;

  // ---- Issuer -------------------------------------------------------------
  const issuerLines = firstPageLines.filter(
    (l) => (recipientLabelLine ? l.y > recipientLabelLine.y + 1 : true) && (firstHeaderY === null || l.y > firstHeaderY),
  );
  result.issuer = readParty(
    issuerLines
      .filter((l) => !DOC_TYPES.some((t) => l.text.toUpperCase().trim() === t))
      .map((l) => l.text),
  );

  // ---- Recipient ------------------------------------------------------------
  if (recipientLabelLine) {
    const blockLines = firstPageLines.filter(
      (l) => l.y < recipientLabelLine.y - 1 && (firstHeaderY === null || l.y > firstHeaderY + 3),
    );
    const leftTexts = blockLines
      .map((l) =>
        l.items
          .filter((i) => kvLeft === null || i.x < kvLeft - 5)
          .map((i) => i.str.trim())
          .join(" ")
          .trim(),
      )
      .filter(Boolean);
    // "To" may carry the name on the same row: "To  MH AUTOMOBILES".
    const sameRow = recipientLabelLine.items
      .slice(1)
      .filter((i) => kvLeft === null || i.x < kvLeft - 5)
      .map((i) => i.str.trim())
      .join(" ")
      .trim();
    result.recipient = readParty(sameRow ? [sameRow, ...leftTexts] : leftTexts);
  } else {
    issues.push(issue("RECIPIENT_BLOCK_NOT_FOUND", "WARNING", "Could not locate the bill-to block", "recipient.name"));
  }

  // ---- Key / value header fields ------------------------------------------
  result.invoiceNumber = readKeyValue(firstPageLines, /^(invoice|bill|inv\.?)\s*(no\.?|number|#)/i, (v) => v.replace(/^[:\s]+/, "").trim() || null);
  result.invoiceDate = readKeyValue(firstPageLines, /^(invoice|bill)?\s*date/i, (v) => parseIndianDate(v.replace(/^[:\s]+/, "")));
  result.paymentTerms = readKeyValue(firstPageLines, /^(invoice\s*type|payment\s*terms|terms\s*of\s*payment|mode\s*of\s*payment)/i, (v) => v.replace(/^[:\s]+/, "").trim() || null);
  result.dispatchThrough = readKeyValue(firstPageLines, /^(despatched|dispatched)\s*through/i, (v) => v.replace(/^[:\s]+/, "").trim() || null);
  result.ewayBillNumber = readKeyValue(firstPageLines, /^e\s*-?\s*way\s*(bill)?\s*no/i, (v) => v.replace(/^[:\s]+/, "").trim() || null);
  result.purchaseOrderNumber = readKeyValue(firstPageLines, /^(buyer'?s?\s*order\s*no|p\.?\s*o\.?\s*(no|number)|order\s*no)/i, (v) => v.replace(/^[:\s]+/, "").trim() || null);
  result.dueDate = readKeyValue(firstPageLines, /^due\s*date/i, (v) => parseIndianDate(v.replace(/^[:\s]+/, "")));
  result.placeOfSupply = readKeyValue(firstPageLines, /^place\s*of\s*supply/i, (v) => v.replace(/^[:\s]+/, "").trim() || null);

  const currencyMatch = doc.plainText.match(/\b(INR|USD|EUR|AED|GBP)\b/);
  const looksIndian = /\bGSTIN\b|\bRupees\b|₹/i.test(doc.plainText);
  result.currency = currencyMatch
    ? field(currencyMatch[1], HIGH, currencyMatch[0])
    : looksIndian
      ? field("INR", MEDIUM, "inferred from GSTIN/Rupees wording")
      : emptyField();

  // ---- Direction ---------------------------------------------------------
  const firm = ctx.firmGstin?.toUpperCase() ?? null;
  if (firm && result.issuer.gstin.value === firm) result.direction = "SALES";
  else if (firm && result.recipient.gstin.value === firm) result.direction = "PURCHASE";
  else if (firm) {
    issues.push(
      issue(
        "DIRECTION_UNKNOWN",
        "ERROR",
        `Neither the issuer GSTIN (${result.issuer.gstin.value ?? "—"}) nor the recipient GSTIN (${result.recipient.gstin.value ?? "—"}) matches this firm (${firm}).`,
        "direction",
      ),
    );
  }

  // ---- Line items ----------------------------------------------------------
  if (layouts.length === 0) {
    issues.push(
      issue(
        "LAYOUT_UNSUPPORTED",
        "ERROR",
        "No line-item table header (Description / Qty / Amount) was found. Line items must be entered manually.",
        "lines",
      ),
    );
  } else {
    result.layoutId = "columnar-gst-invoice";
    result.lines = readLineItems(lines, layouts, issues);
  }

  // ---- Totals -------------------------------------------------------------
  result.totals = readTotals(lines, layouts, issues);

  return result;
}

// ===========================================================================
// Parties
// ===========================================================================

const ADDRESS_HINT =
  /\d|\b(floor|door|road|rd|shop|complex|bldg|building|street|st|nagar|cross|main|opp|near|plot|house|layout|lane|market)\b/i;

function readParty(texts: string[]): PartyDetails {
  const party = emptyParty();
  for (const raw of texts) {
    const text = raw.trim();
    if (!text) continue;
    if (/^gstin|gst\s*no|gstin\/uin/i.test(text)) {
      const candidate = findGstinCandidate(text.replace(/^[^:]*:/, ""));
      if (candidate) {
        party.gstin = field(candidate, HIGH, text);
        party.stateCode = gstinStateCode(candidate);
      } else {
        party.gstin = { value: null, confidence: 0, raw: text };
      }
      continue;
    }
    if (/^(phone|ph|mobile|mob|tel|contact)\b/i.test(text)) {
      const digits = text.match(/(\+?91[\s-]?)?[6-9]\d{9}/);
      party.phone = digits ? field(digits[0].replace(/\D/g, "").slice(-10), HIGH, text) : { value: null, confidence: 0, raw: text };
      continue;
    }
    if (/^e-?mail\b/i.test(text)) {
      const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      party.email = email ? field(email[0], HIGH, text) : party.email;
      continue;
    }
    if (party.name.value === null) {
      // Business names are sometimes printed with the first address fragment on
      // the same row ("EVERGREEN TRADERS, 92/134A,"). Keep the raw row; the
      // name is the part before the first comma that is followed by a digit.
      const commaAt = text.indexOf(",");
      const rest = commaAt > 0 ? text.slice(commaAt + 1) : "";
      const split =
        commaAt >= 3 && ADDRESS_HINT.test(rest) ? [text, text.slice(0, commaAt), rest.trim()] : null;
      if (split) {
        party.name = field(split[1].trim(), MEDIUM, text);
        const rest = split[2].replace(/,\s*$/, "").trim();
        if (rest) party.addressLines.push(rest);
      } else {
        party.name = field(text.replace(/,\s*$/, "").trim(), HIGH, text);
      }
      continue;
    }
    party.addressLines.push(text.replace(/,\s*$/, "").trim());
  }
  return party;
}

function readKeyValue<T>(lines: TextLine[], label: RegExp, parse: (value: string) => T | null): Field<T> {
  for (const line of lines) {
    for (const [index, item] of line.items.entries()) {
      const text = item.str.trim();
      if (!label.test(text)) continue;
      // Value may be glued to the label ("Invoice No. : 136") or in following items.
      const glued = text.replace(label, "").replace(/^[\s.:]+/, "").trim();
      const next = line.items
        .slice(index + 1)
        .filter((other) => other.x - (item.x + item.width) < 160)
        .map((other) => other.str.trim())
        .filter((s) => !/^[:]$/.test(s));
      // Stop at the next label on the same row.
      const stop = next.findIndex((s) => /:\s*$/.test(s) && /[a-z]{3}/i.test(s));
      const valueText = [glued, ...(stop === -1 ? next : next.slice(0, stop))].filter(Boolean).join(" ").trim();
      if (!valueText) return { value: null, confidence: 0, raw: line.text };
      const value = parse(valueText);
      return value === null ? { value: null, confidence: 0, raw: valueText } : field(value, HIGH, valueText);
    }
  }
  return emptyField();
}

// ===========================================================================
// Line items
// ===========================================================================

function detectLayout(pageLines: TextLine[], page: number): PageLayout | null {
  for (const line of pageLines) {
    const found = new Map<ColumnKey, Column>();
    for (const item of line.items) {
      const text = item.str.trim().replace(/\s+/g, " ");
      for (const [key, pattern] of COLUMN_PATTERNS) {
        if (!found.has(key) && pattern.test(text)) {
          found.set(key, { key, left: item.x, right: item.x + item.width, center: item.x + item.width / 2 });
          break;
        }
      }
    }
    // Header labels can sit on a couple of baselines ("Sl" above "No",
    // "Gst%"/"Rate" slightly higher): merge nearby rows within 8pt.
    for (const other of pageLines) {
      if (other === line || Math.abs(other.y - line.y) > 8) continue;
      for (const item of other.items) {
        const text = item.str.trim().replace(/\s+/g, " ");
        for (const [key, pattern] of COLUMN_PATTERNS) {
          if (!found.has(key) && pattern.test(text)) {
            found.set(key, { key, left: item.x, right: item.x + item.width, center: item.x + item.width / 2 });
            break;
          }
        }
      }
    }
    if (!(found.has("description") && found.has("amount") && (found.has("quantity") || found.has("rate")))) continue;

    const columns = [...found.values()].sort((a, b) => a.left - b.left);
    const bounds = new Map<ColumnKey, [number, number]>();
    for (const [i, col] of columns.entries()) {
      const prev = columns[i - 1];
      const next = columns[i + 1];
      let lo = prev ? (prev.right + col.left) / 2 : -Infinity;
      let hi = next ? (col.right + next.left) / 2 : Infinity;
      // Description text is left-aligned right after the serial number, so
      // the serial column ends (and the description starts) at the "Sl" label.
      if (col.key === "description" && prev?.key === "sl") lo = prev.right + 2;
      if (col.key === "sl" && next?.key === "description") hi = col.right + 2;
      bounds.set(col.key, [lo, hi]);
    }
    const headerY = Math.min(line.y, ...pageLines.filter((o) => Math.abs(o.y - line.y) <= 8).map((o) => o.y));
    return { page, headerY, columns, bounds };
  }
  return null;
}

function columnOf(layout: PageLayout, item: TextItem): ColumnKey | null {
  const text = item.str;
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  const charWidth = text.length ? item.width / text.length : 0;
  const left = item.x + leading * charWidth;
  const right = item.x + item.width - trailing * charWidth;
  const center = (left + right) / 2;
  // Long text runs (descriptions) are classified by where they start.
  const probe = right - left > 60 ? left + 1 : center;
  for (const [key, [lo, hi]] of layout.bounds) {
    if (probe >= lo && probe < hi) return key;
  }
  return null;
}

const TOTALS_START = /^(gross\s*amount|sub\s*-?\s*total|total\s*taxable|taxable\s*value|gst%|igst%|total\b|amount\s*in\s*words|bank\s*details)/i;
const ADJUSTMENT_TEXT =
  /\b(discount|disc\.?|less|rebate|round\s*(off|up)|freight|packing|packaging|forwarding|transport(ation)?|courier|loading|unloading|insurance|cess|delivery\s*charges?|handling\s*charges?)\b/i;

interface RowCells {
  sl: string | null;
  cells: Map<ColumnKey, string[]>;
  raw: string;
  page: number;
  y: number;
  maskedRate: boolean;
}

function readLineItems(lines: TextLine[], layouts: PageLayout[], issues: ExtractionIssue[]): ExtractedLine[] {
  const rows: RowCells[] = [];
  for (const layout of layouts) {
    const pageLines = lines.filter((l) => l.page === layout.page && l.y < layout.headerY - 2);
    for (const line of pageLines) {
      if (TOTALS_START.test(line.items[0]?.str.trim() ?? "") || line.items.some((i) => /gross\s*amount|taxable\s*value/i.test(i.str))) break;
      if (/^no\.?$/i.test(line.text.trim())) continue; // second header row ("No" under "Sl")
      const cells = new Map<ColumnKey, string[]>();
      const slColumn = layout.columns.find((c) => c.key === "sl");
      for (const [index, item] of line.items.entries()) {
        // Serial numbers are right-aligned and overshoot the narrow "Sl" label.
        const isSerial =
          index === 0 && slColumn && /^\s*\d{1,3}\.?\s*$/.test(item.str) && item.x + item.width < slColumn.right + 15;
        const key = isSerial ? "sl" : columnOf(layout, item);
        if (!key) continue;
        cells.set(key, [...(cells.get(key) ?? []), item.str.trim()]);
      }
      if (cells.size === 0) continue;
      const slText = cells.get("sl")?.join(" ") ?? null;
      rows.push({
        sl: slText && /^\d+\.?$/.test(slText) ? slText.replace(".", "") : null,
        cells,
        raw: line.text,
        page: layout.page,
        y: line.y,
        maskedRate: (cells.get("rate") ?? []).some(isMaskedNumber),
      });
    }
  }

  // Group rows into items: a row with a serial number starts an item; rows
  // without one continue the previous item's description.
  const groups: RowCells[][] = [];
  for (const row of rows) {
    if (row.sl !== null || groups.length === 0) groups.push([row]);
    else groups[groups.length - 1].push(row);
  }

  // An un-numbered row above the first numbered row whose figures are blank or
  // zero is the first half of a wrapped description (the source software
  // prints it with "0 0.00 0.00" placeholders). Fold it into the next item.
  const prefixNotes = new Map<RowCells[], string>();
  if (groups.length > 1 && groups[0][0].sl === null) {
    const orphan = groups[0];
    const numericValues = orphan.flatMap((r) =>
      (["quantity", "gst", "rate", "amount"] as ColumnKey[]).flatMap((k) => r.cells.get(k) ?? []),
    );
    if (numericValues.every((v) => (parseAmount(v.replace("%", "")) ?? 0) === 0)) {
      const orphanText = orphan.flatMap((r) => r.cells.get("description") ?? []).join(" ");
      groups.shift();
      const target = groups[0];
      target[0] = {
        ...target[0],
        cells: new Map(target[0].cells).set("description", [orphanText, ...(target[0].cells.get("description") ?? [])]),
        raw: `${orphan.map((r) => r.raw).join(" | ")} | ${target[0].raw}`,
      };
      prefixNotes.set(target, orphanText);
    }
  }

  const out: ExtractedLine[] = [];
  for (const group of groups) {
    const first = group[0];
    const lineNo = first.sl ? Number(first.sl) : out.length + 1;
    const pick = (key: ColumnKey) => group.flatMap((r) => r.cells.get(key) ?? []).filter(Boolean);
    const descParts = pick("description");
    const description = descParts.join(" ").replace(/\s+/g, " ").trim();
    const hsnText = pick("hsn").join(" ");
    const qtyText = pick("quantity").join(" ");
    const unitText = pick("unit").join(" ");
    const gstText = pick("gst").join(" ");
    const rateText = pick("rate").join(" ");
    const discText = pick("discount").join(" ");
    const amountText = pick("amount").join(" ");
    const raw = group.map((r) => r.raw).join(" | ");
    const fieldPath = (name: string) => `lines.${lineNo}.${name}`;

    const qtyMatch = qtyText.match(/^(-?\d+(?:\.\d+)?)\s*([A-Za-z.]+)?$/);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : null;
    const unit = (unitText || qtyMatch?.[2] || "").toUpperCase().replace(/\.$/, "") || null;
    const hsnMatch = hsnText.match(/^\d{4,8}$/);
    const gst = gstText ? parseAmount(gstText.replace("%", "")) : null;
    const rate = parseAmount(rateText);
    const discount = discText ? parseAmount(discText.replace("%", "")) : null;
    const amount = parseAmount(amountText);

    const line: ExtractedLine = {
      lineNo,
      kind: "ITEM",
      description: description ? field(description, group.length > 1 ? MEDIUM : HIGH, descParts.join(" ")) : emptyField(),
      hsn: hsnMatch ? field(hsnMatch[0], HIGH, hsnText) : { value: null, confidence: 0, raw: hsnText || null },
      sku: emptyField(),
      barcode: emptyField(),
      brand: emptyField(),
      quantity: quantity !== null ? field(quantity, HIGH, qtyText) : { value: null, confidence: 0, raw: qtyText || null },
      unit: unit ? field(unit, HIGH, unitText || qtyText) : emptyField(),
      rate: rate !== null ? field(rate, HIGH, rateText) : { value: null, confidence: 0, raw: rateText || null },
      discountPercent: discount !== null ? field(discount, HIGH, discText) : emptyField(),
      gstRate: gst !== null ? field(gst, HIGH, gstText) : { value: null, confidence: 0, raw: gstText || null },
      amount: amount !== null ? field(amount, HIGH, amountText) : { value: null, confidence: 0, raw: amountText || null },
      rawText: raw,
      page: first.page,
    };

    if (ADJUSTMENT_TEXT.test(description) || (amount !== null && amount < 0)) line.kind = "ADJUSTMENT";

    const brand = description.match(/^([A-Z][A-Z&.]+)\s/);
    if (brand && line.kind === "ITEM" && brand[1].length >= 3) line.brand = field(brand[1], LOW, brand[0]);

    if (prefixNotes.has(group)) {
      line.description.confidence = LOW;
      issues.push(
        issue(
          "LINE_DESCRIPTION_MERGED",
          "WARNING",
          `Line ${lineNo}: un-numbered row "${prefixNotes.get(group)}" (zero values) was treated as the start of this item's description`,
          fieldPath("description"),
        ),
      );
    }
    if (!description) issues.push(issue("LINE_DESCRIPTION_MISSING", "ERROR", `Line ${lineNo}: no description`, fieldPath("description")));
    if (amount === null) issues.push(issue("LINE_AMOUNT_UNREADABLE", "ERROR", `Line ${lineNo}: amount "${amountText}" could not be read`, fieldPath("amount")));
    if (quantity === null) issues.push(issue("LINE_QUANTITY_UNREADABLE", "ERROR", `Line ${lineNo}: quantity "${qtyText}" could not be read`, fieldPath("quantity")));
    if (rate === null) {
      issues.push(
        issue(
          group.some((r) => r.maskedRate) ? "LINE_RATE_OVERFLOW" : "LINE_RATE_UNREADABLE",
          "WARNING",
          group.some((r) => r.maskedRate)
            ? `Line ${lineNo}: rate is printed as "${rateText}" (column overflow on the source document)`
            : `Line ${lineNo}: rate "${rateText}" could not be read`,
          fieldPath("rate"),
        ),
      );
    }
    if (!hsnMatch && line.kind === "ITEM") {
      issues.push(issue("LINE_HSN_MISSING", "WARNING", `Line ${lineNo}: HSN code is not printed`, fieldPath("hsn")));
    }
    if (gst === null) issues.push(issue("LINE_GST_RATE_MISSING", "WARNING", `Line ${lineNo}: GST rate is not printed`, fieldPath("gstRate")));
    out.push(line);
  }

  // Serial numbers must run 1..n without gaps; a gap usually means a row was
  // not recognised (e.g. split across a page break).
  out.forEach((line, index) => {
    if (line.lineNo !== index + 1) {
      issues.push(
        issue("LINE_SEQUENCE_GAP", "WARNING", `Line numbering jumps to ${line.lineNo} at position ${index + 1}`, `lines.${line.lineNo}`),
      );
    }
  });
  if (out.length === 0) issues.push(issue("NO_LINE_ITEMS", "ERROR", "No line items were found in the item table", "lines"));
  return out;
}

// ===========================================================================
// Totals
// ===========================================================================

function emptyTotals(): ExtractedTotals {
  return {
    grossAmount: emptyField(),
    discountPercent: emptyField(),
    discountAmount: emptyField(),
    taxableAmount: emptyField(),
    cgst: emptyField(),
    sgst: emptyField(),
    igst: emptyField(),
    cess: emptyField(),
    freight: emptyField(),
    packing: emptyField(),
    otherCharges: emptyField(),
    roundOff: emptyField(),
    grandTotal: emptyField(),
    amountInWords: emptyField(),
    amountInWordsValue: null,
    taxRateSummary: [],
  };
}

type TotalKey =
  | "grossAmount"
  | "discountAmount"
  | "taxableAmount"
  | "cgst"
  | "sgst"
  | "igst"
  | "cess"
  | "freight"
  | "packing"
  | "otherCharges"
  | "roundOff"
  | "grandTotal";

const TOTAL_LABELS: Array<[TotalKey, RegExp]> = [
  ["grossAmount", /^(gross\s*amount|sub\s*-?\s*total|total\s*amount\s*before\s*tax)/i],
  ["discountAmount", /^(discount|less\s*:?\s*discount|trade\s*discount)/i],
  ["taxableAmount", /^(taxable\s*(amount|value)|net\s*taxable)/i],
  ["cgst", /^(add\s*)?cgst/i],
  ["sgst", /^(add\s*)?(sgst|utgst)/i],
  ["igst", /^(add\s*)?igst/i],
  ["cess", /^(add\s*)?cess/i],
  ["freight", /^(add\s*)?(freight|transport(ation)?|courier|delivery\s*charges?)/i],
  ["packing", /^(add\s*)?(packing|packaging|forwarding)/i],
  ["otherCharges", /^(add\s*)?(other\s*charges|misc)/i],
  ["roundOff", /^(round\s*(up|off|ing)|rounded\s*off)/i],
  ["grandTotal", /^(bill\s*amount|grand\s*total|net\s*amount|invoice\s*total|total\s*amount|amount\s*payable|net\s*payable)/i],
];

function readTotals(lines: TextLine[], layouts: PageLayout[], issues: ExtractionIssue[]): ExtractedTotals {
  const totals = emptyTotals();
  const lastPage = Math.max(...lines.map((l) => l.page), 1);
  const pageLines = lines.filter((l) => l.page === lastPage);
  const items = pageLines.flatMap((l) => l.items);
  const layout = layouts.find((l) => l.page === lastPage) ?? layouts[layouts.length - 1];
  const amountBounds = layout?.bounds.get("amount");

  // Labels of the totals block.
  const labels: Array<{ key: TotalKey; item: TextItem; text: string }> = [];
  for (const item of items) {
    const text = item.str.trim();
    if (layout && item.y >= layout.headerY) continue;
    for (const [key, pattern] of TOTAL_LABELS) {
      if (pattern.test(text)) {
        labels.push({ key, item, text });
        break;
      }
    }
  }
  // Keep only labels in the right-hand totals column (left-side "GST%" /
  // "Taxable Value" tables belong to the rate summary).
  const labelColumnX = labels.find((l) => l.key === "grandTotal")?.item.x ?? labels.find((l) => l.key === "grossAmount")?.item.x;
  const totalLabels = labels.filter((l) => labelColumnX === undefined || Math.abs(l.item.x - labelColumnX) < 40);
  if (totalLabels.length === 0) {
    issues.push(issue("TOTALS_NOT_FOUND", "ERROR", "No totals block (Gross / Tax / Bill Amount) was found", "totals"));
    return totals;
  }

  const topY = Math.max(...totalLabels.map((l) => l.item.y)) + 6;
  const bottomY = Math.min(...totalLabels.map((l) => l.item.y)) - 6;
  const valueLeft = amountBounds ? amountBounds[0] : Math.max(...totalLabels.map((l) => l.item.x + l.item.width));
  const values = items
    .filter((i) => i.x + i.width / 2 >= valueLeft && i.y <= topY && i.y >= bottomY)
    .map((i) => ({ item: i, value: parseAmount(i.str) }))
    .filter((v): v is { item: TextItem; value: number } => v.value !== null);

  // Greedy nearest-baseline pairing.
  const pairs: Array<{ label: (typeof totalLabels)[number]; value: (typeof values)[number]; dy: number }> = [];
  for (const label of totalLabels) for (const value of values) pairs.push({ label, value, dy: Math.abs(label.item.y - value.item.y) });
  pairs.sort((a, b) => a.dy - b.dy);
  const usedLabels = new Set<object>();
  const usedValues = new Set<object>();
  for (const pair of pairs) {
    if (pair.dy > 12 || usedLabels.has(pair.label) || usedValues.has(pair.value)) continue;
    usedLabels.add(pair.label);
    usedValues.add(pair.value);
    const { key, text } = pair.label;
    const confidence = pair.dy <= 4 ? HIGH : MEDIUM;
    (totals[key] as Field<number>) = field(key === "discountAmount" ? Math.abs(pair.value.value) : pair.value.value, confidence, pair.value.item.str.trim());
    if (key === "discountAmount") {
      const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pct) totals.discountPercent = field(Number(pct[1]), HIGH, text);
    }
  }
  for (const label of totalLabels) {
    if (!usedLabels.has(label)) {
      issues.push(issue("TOTAL_VALUE_UNPAIRED", "WARNING", `No value found next to "${label.text}"`, `totals.${label.key}`));
    }
  }

  // An unlabelled value between the discount/gross line and the first tax
  // line is the taxable sub-total ("Gross − Discount").
  const unpaired = values.filter((v) => !usedValues.has(v));
  if (totals.taxableAmount.value === null && unpaired.length > 0) {
    const anchorY = Math.min(
      ...[totals.discountAmount, totals.grossAmount]
        .map((f) => values.find((v) => usedValues.has(v) && v.item.str.trim() === f.raw)?.item.y)
        .filter((y): y is number => y !== undefined),
    );
    const candidates = unpaired.filter((v) => v.item.y < anchorY).sort((a, b) => b.item.y - a.item.y);
    if (candidates[0]) {
      totals.taxableAmount = field(candidates[0].value, MEDIUM, candidates[0].item.str.trim());
      usedValues.add(candidates[0]);
    }
  }
  for (const value of values.filter((v) => !usedValues.has(v))) {
    issues.push(issue("TOTAL_VALUE_UNLABELLED", "INFO", `Unlabelled amount ${value.item.str.trim()} in the totals block`, "totals"));
  }

  // Amount in words.
  const wordsLine = pageLines.find((l) => /amount\s*in\s*words/i.test(l.text));
  if (wordsLine) {
    const labelItem = wordsLine.items.find((i) => /amount\s*in\s*words/i.test(i.str))!;
    const words = wordsLine.items
      .filter((i) => i.x > labelItem.x && (labelColumnX === undefined || i.x < labelColumnX - 5))
      .map((i) => i.str.trim())
      .join(" ")
      .replace(/^amount\s*in\s*words\s*:?/i, "")
      .replace(/^:\s*/, "")
      .trim();
    if (words) {
      totals.amountInWords = field(words, HIGH, words);
      totals.amountInWordsValue = parseAmountInWords(words);
      if (totals.amountInWordsValue === null) {
        issues.push(issue("AMOUNT_IN_WORDS_UNPARSED", "WARNING", `Could not interpret amount in words: "${words}"`, "totals.amountInWords"));
      }
    }
  }

  totals.taxRateSummary = readTaxRateSummary(pageLines, labelColumnX ?? Infinity);
  return totals;
}

/**
 * Reads the rate-wise GST table printed under the items:
 *   GST%  Taxable Value  SGST %  SGST Amt  CGST %  CGST Amt
 *   18.0%   27250.09      9.0%   2452.51   9.0%    2452.51
 * or the IGST variant (IGST%, Taxable Value, IGST Amt).
 */
function readTaxRateSummary(pageLines: TextLine[], rightLimit: number): TaxRateSummaryRow[] {
  const header = pageLines.find(
    (l) => /taxable\s*value/i.test(l.text) && /(cgst|sgst|igst)/i.test(l.text) && /%/.test(l.text),
  );
  if (!header) return [];
  const isIgst = /igst/i.test(header.text) && !/cgst/i.test(header.text);
  const rateHeader = header.items.find((i) => /^(i?gst\s*%|rate)$/i.test(i.str.trim()));
  const rows: TaxRateSummaryRow[] = [];
  // Rows may sit a point or two off their siblings' baseline; merge items
  // within 3pt into one row before reading.
  const below = pageLines.filter((l) => l.y < header.y - 2).flatMap((l) => l.items).filter((i) => i.x < rightLimit - 5);
  const rateItems = below.filter(
    (i) => /^\d+(\.\d+)?%$/.test(i.str.trim()) && (!rateHeader || Math.abs(i.x - rateHeader.x) < 25),
  );
  for (const rateItem of rateItems) {
    const rowItems = below
      .filter((i) => i !== rateItem && Math.abs(i.y - rateItem.y) <= 3 && i.x > rateItem.x)
      .sort((a, b) => a.x - b.x);
    const numbers = rowItems.filter((i) => !/%/.test(i.str)).map((i) => parseAmount(i.str)).filter((n): n is number => n !== null);
    const ratePercent = Number(rateItem.str.replace("%", ""));
    if (isIgst && numbers.length >= 2) {
      rows.push({ ratePercent, taxableValue: numbers[0], cgst: 0, sgst: 0, igst: numbers[1] });
    } else if (!isIgst && numbers.length >= 3) {
      rows.push({ ratePercent, taxableValue: numbers[0], sgst: numbers[1], cgst: numbers[2], igst: 0 });
    }
  }
  return rows.sort((a, b) => a.ratePercent - b.ratePercent);
}

function issue(code: string, severity: ExtractionIssue["severity"], message: string, fieldPath?: string): ExtractionIssue {
  return { code, severity, message, field: fieldPath };
}
