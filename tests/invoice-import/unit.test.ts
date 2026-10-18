/**
 * Unit tests for the framework-free invoice import library. Catalogue data
 * comes from the committed data/historical-csv/catalog-products.json; ZIP
 * edge cases use small archives built in memory (no invoice data).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, it } from "node:test";

import { ProductMatcher, partyKeyFor, type CatalogueProduct } from "../../src/lib/invoice-import/matching";
import {
  isValidGstin,
  modelTokens,
  parseAmount,
  parseAmountInWords,
  parseIndianDate,
} from "../../src/lib/invoice-import/normalize";
import { reconcile } from "../../src/lib/invoice-import/reconcile";
import type { DraftInvoice } from "../../src/lib/invoice-import/draft";
import { detectMimeType, readZip } from "../../src/lib/invoice-import/zip";

describe("normalize", () => {
  it("parses amounts and refuses masked cells", () => {
    assert.equal(parseAmount("27,250.09"), 27250.09);
    assert.equal(parseAmount("1,02,936.00"), 102936);
    assert.equal(parseAmount("   -0.11"), -0.11);
    assert.equal(parseAmount("*****.**"), null);
    assert.equal(parseAmount("PCS"), null);
  });

  it("parses DD/MM/YYYY dates strictly", () => {
    assert.equal(parseIndianDate("02/04/2026"), "2026-04-02");
    assert.equal(parseIndianDate("31/02/2026"), null);
    assert.equal(parseIndianDate("2026-04-02"), null);
  });

  it("validates GSTIN check digits", () => {
    assert.equal(isValidGstin("29FMKPM8993P1ZI"), true); // Technic Technology
    assert.equal(isValidGstin("29AAIPH4146G1ZP"), true);
    assert.equal(isValidGstin("29ADGPG4240KIZF"), false); // printed with "I" for "1" (invoice 189)
    assert.equal(isValidGstin("29A00PC8361E1ZQ"), false); // digits where the PAN needs letters (178, 206)
  });

  it("reads Indian amount-in-words", () => {
    assert.equal(parseAmountInWords("Rupees Thirty Two Thousand One Hundred Fifty Five only"), 32155);
    assert.equal(parseAmountInWords("Rupees One Lakhs Two Thousand Nine Hundred Thirty Six only"), 102936);
    assert.equal(parseAmountInWords("Rupees Two Lakhs One Thousand Seven Hundred Eighty One only"), 201781);
    assert.equal(parseAmountInWords("Rupees Ten and Fifty Paise only"), 10.5);
    assert.equal(parseAmountInWords("Rupees Thirty Banana only"), null);
  });

  it("keeps model codes but not capacities or warranty text", () => {
    assert.deepEqual(modelTokens("YOKOHAMA 125E41L 100AH(WARRENTY24+24)PREMIUM"), ["125E41L"]);
    assert.deepEqual(modelTokens("YOKOHAMA B2036B20L 32AH (WARRENTY18+6)"), ["B2036B20L"]);
  });
});

describe("product matching", () => {
  const catalogue: CatalogueProduct[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/historical-csv/catalog-products.json"), "utf8"),
  ).map((p: { sku: string; name: string; hsn: string }, i: number) => ({ id: `p${i}`, sku: p.sku, name: p.name, hsnCode: p.hsn }));
  const matcher = new ProductMatcher(catalogue);
  const byName = (name: string) => catalogue.find((p) => p.name === name)!;

  it("matches a description equal to the catalogue name despite spacing/case differences", () => {
    const target = byName("YOKOHAMA 125E41L 100AH(WARRENTY24+24)PREMIUM");
    const result = matcher.match({ kind: "ITEM", description: "yokohama 125E41L 100AH (WARRENTY 24+24) PREMIUM" });
    assert.equal(result.status, "MATCHED");
    assert.equal(result.method, "NAME_NORMALIZED");
    assert.equal(result.productId, target.id);
  });

  it("matches a printed SKU exactly", () => {
    const target = catalogue[0];
    const result = matcher.match({ kind: "ITEM", description: "anything", sku: target.sku.toLowerCase() });
    assert.equal(result.status, "MATCHED");
    assert.equal(result.productId, target.id);
  });

  it("never auto-assigns a fuzzy match", () => {
    const result = matcher.match({ kind: "ITEM", description: "YOKOHAMA 125E41L 100AH PREMIUM BATTERY NEW" });
    assert.notEqual(result.status, "MATCHED");
    assert.equal(result.productId, null);
  });

  it("does not confuse left- and right-terminal models", () => {
    const left = byName("YOKOHAMA B2036B20L 32AH (WARRENTY18+6)");
    const local = new ProductMatcher(catalogue.filter((p) => p.id === left.id));
    const result = local.match({ kind: "ITEM", description: "YOKOHAMA B2036B20R 32AH (WARRENTY18+6)" });
    assert.equal(result.productId, null);
    assert.ok(result.candidates.every((c) => c.score <= 0.5), "conflicting model code must be capped below the suggestion threshold");
  });

  it("uses party-specific aliases before firm-wide ones", () => {
    const [a, b] = catalogue;
    const withAliases = new ProductMatcher(catalogue, [
      { aliasKey: "SUPPCODE123", productId: a.id, partyKey: "" },
      { aliasKey: "SUPPCODE123", productId: b.id, partyKey: partyKeyFor("29ABCDE1234F1Z5", null) },
    ]);
    assert.equal(withAliases.match({ kind: "ITEM", description: "SUPP-CODE 123", partyKey: partyKeyFor("29ABCDE1234F1Z5", null) }).productId, b.id);
    assert.equal(withAliases.match({ kind: "ITEM", description: "SUPP-CODE 123", partyKey: "GSTIN:OTHER" }).productId, a.id);
  });

  it("skips discount/charge lines", () => {
    assert.equal(matcher.match({ kind: "ADJUSTMENT", description: "DP DISCOUNT 30%" }).status, "NOT_APPLICABLE");
  });
});

describe("reconciliation", () => {
  const base: DraftInvoice = {
    direction: "SALES", documentType: "TAX INVOICE", invoiceNumber: "X1", invoiceDate: "2026-04-02", dueDate: null,
    paymentTerms: "CASH", purchaseOrderNumber: null, dispatchThrough: null, ewayBillNumber: null, currency: "INR",
    placeOfSupply: null, issuerName: "TECHNIC TECHNOLOGY", issuerGstin: "29FMKPM8993P1ZI", partyName: "MH AUTOMOBILES",
    partyGstin: "29AAIPH4146G1ZP", partyPhone: null, partyAddress: null,
    // Figures of invoice 136.
    lines: [
      { lineNo: 1, kind: "ITEM", description: "YOKOHAMA MTZ4L", hsn: "85071000", sku: null, barcode: null, brand: null, quantity: 17, unit: "PCS", rate: 600.85, discountPercent: null, gstRate: 18, amount: 10214.45, rawText: "" },
      { lineNo: 2, kind: "ITEM", description: "YOKOHAMA MTZ5LA", hsn: "85071000", sku: null, barcode: null, brand: null, quantity: 23, unit: "PCS", rate: 740.68, discountPercent: null, gstRate: 18, amount: 17035.64, rawText: "" },
    ],
    totals: { grossAmount: 27250.09, discountPercent: null, discountAmount: null, taxableAmount: 27250.09, cgst: 2452.51, sgst: 2452.51, igst: null, cess: null, freight: null, packing: null, otherCharges: null, roundOff: -0.11, grandTotal: 32155 },
    amountInWords: "Rupees Thirty Two Thousand One Hundred Fifty Five only", amountInWordsValue: 32155, taxRateSummary: [],
  };

  it("reconciles a correct invoice with no errors", () => {
    const result = reconcile(base, { firmGstin: "29FMKPM8993P1ZI", today: "2026-10-15" });
    assert.equal(result.calculated.grandTotal, 32155);
    assert.equal(result.grandTotalDifference, 0);
    assert.deepEqual(result.issues.filter((i) => i.severity === "ERROR"), []);
  });

  it("flags — but does not change — a wrong printed total", () => {
    const draft = { ...base, totals: { ...base.totals, grandTotal: 32255 } };
    const result = reconcile(draft, { firmGstin: "29FMKPM8993P1ZI", today: "2026-10-15" });
    assert.ok(result.issues.some((i) => i.code === "GRAND_TOTAL_MISMATCH"));
    assert.ok(result.issues.some((i) => i.code === "AMOUNT_IN_WORDS_MISMATCH"));
    assert.equal(draft.totals.grandTotal, 32255);
  });

  it("flags a line whose quantity × rate disagrees with its amount", () => {
    const lines = [{ ...base.lines[0], amount: 10314.45 }, base.lines[1]];
    const result = reconcile({ ...base, lines }, { firmGstin: "29FMKPM8993P1ZI", today: "2026-10-15" });
    assert.ok(result.issues.some((i) => i.code === "LINE_AMOUNT_MISMATCH"));
  });

  it("flags IGST charged on an intra-state sale", () => {
    const totals = { ...base.totals, cgst: null, sgst: null, igst: 4905.02 };
    const result = reconcile({ ...base, totals }, { firmGstin: "29FMKPM8993P1ZI", today: "2026-10-15" });
    assert.ok(result.issues.some((i) => i.code === "TAX_TYPE_MISMATCH"));
  });
});

describe("zip reader", () => {
  it("unpacks the real archive, including the nested ZIP", { skip: !fs.existsSync("public/technic.zip") }, () => {
    const contents = readZip(fs.readFileSync("public/technic.zip"));
    assert.equal(contents.files.length, 162);
    assert.equal(contents.files.filter((f) => f.path.includes("186.zip!/")).length, 81);
    assert.equal(contents.skipped.length, 0);
    assert.ok(contents.files.every((f) => detectMimeType(f.data, f.name) === "application/pdf"));
  });

  it("reports encrypted entries instead of skipping them silently", () => {
    const zip = buildZip([{ name: "secret.pdf", data: Buffer.from("%PDF-1.7 x"), encrypted: true }]);
    const contents = readZip(zip);
    assert.equal(contents.files.length, 0);
    assert.match(contents.skipped[0].reason, /password-protected/);
  });

  it("detects corrupt entries by CRC", () => {
    const zip = buildZip([{ name: "a.pdf", data: Buffer.from("%PDF-1.7 hello"), corruptCrc: true }]);
    assert.match(readZip(zip).skipped[0].reason, /corrupt/i);
  });
});

/** Builds a tiny deflate ZIP in memory for edge-case tests. */
function buildZip(entries: Array<{ name: string; data: Buffer; encrypted?: boolean; corruptCrc?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = zlib.crc32(entry.data) ^ (entry.corruptCrc ? 1 : 0);
    const name = Buffer.from(entry.name);
    const flags = entry.encrypted ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
