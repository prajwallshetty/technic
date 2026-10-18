/**
 * Runs extraction over the real invoices in public/technic.zip and compares
 * against the manually verified ground truth in
 * data/invoice-import/ground-truth.json. Both are confidential and not in
 * git, so the suite skips when they are absent.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { evaluateDraft, extractDocument } from "../../src/lib/invoice-import/pipeline";
import { readZip } from "../../src/lib/invoice-import/zip";

const ZIP = "public/technic.zip";
const GT = "data/invoice-import/ground-truth.json";
const FIRM_GSTIN = "29FMKPM8993P1ZI";
const available = fs.existsSync(ZIP);

describe("real invoices from technic.zip", { skip: !available && "public/technic.zip not present" }, () => {
  const files = available ? readZip(fs.readFileSync(ZIP)).files.filter((f) => !f.path.includes("186.zip!/")) : [];

  it("reads all 81 top-level PDFs from their text layer and reconciles every grand total", async () => {
    assert.equal(files.length, 81);
    for (const file of files) {
      const out = await extractDocument(file.data, { sourceFilename: file.name, mimeType: "application/pdf", firmGstin: FIRM_GSTIN });
      assert.equal(out.text.method, "PDF_TEXT", file.name);
      assert.equal(out.draft.direction, "SALES", file.name);
      assert.ok(out.draft.lines.length > 0, `${file.name} has lines`);
      const ev = evaluateDraft(out.draft, { firmGstin: FIRM_GSTIN, matcher: null, today: "2026-10-15" }, out.extraction.issues);
      assert.equal(ev.reconciliation.grandTotalDifference, 0, `${file.name}: printed vs calculated grand total`);
      assert.equal(out.draft.amountInWordsValue, out.draft.totals.grandTotal, `${file.name}: amount in words`);
    }
  });

  it("matches the manually verified ground truth field by field", { skip: !fs.existsSync(GT) && "ground truth not present" }, async () => {
    const gt = JSON.parse(fs.readFileSync(GT, "utf8")) as {
      invoices: Array<{ file: string; invoiceNumber: string; invoiceDate: string; customerName: string; customerGstin: string | null; lines: unknown[][]; totals: Record<string, number | null> }>;
    };
    for (const expected of gt.invoices) {
      const file = files.find((f) => f.name === expected.file);
      assert.ok(file, expected.file);
      const { draft } = await extractDocument(file.data, { sourceFilename: file.name, mimeType: "application/pdf", firmGstin: FIRM_GSTIN });
      assert.equal(draft.invoiceNumber, expected.invoiceNumber, `${expected.file} number`);
      assert.equal(draft.invoiceDate, expected.invoiceDate, `${expected.file} date`);
      assert.equal(draft.partyName, expected.customerName, `${expected.file} customer`);
      assert.equal(draft.partyGstin, expected.customerGstin, `${expected.file} gstin`);
      assert.equal(draft.lines.length, expected.lines.length, `${expected.file} line count`);
      expected.lines.forEach(([kind, description, hsn, quantity, unit, gstRate, rate, amount], i) => {
        const line = draft.lines[i];
        assert.deepEqual(
          [line.kind, line.description, line.hsn, line.quantity, line.unit, line.gstRate, line.rate, line.amount],
          [kind, description, hsn, quantity, unit, gstRate, rate, amount],
          `${expected.file} line ${i + 1}`,
        );
      });
      for (const [key, value] of Object.entries(expected.totals)) {
        assert.equal(draft.totals[key as keyof typeof draft.totals], value, `${expected.file} totals.${key}`);
      }
    }
  });

  it("flags the known source-document problems", async () => {
    const get = async (name: string) => {
      const file = files.find((f) => f.name === name)!;
      const out = await extractDocument(file.data, { sourceFilename: name, mimeType: "application/pdf", firmGstin: FIRM_GSTIN });
      return evaluateDraft(out.draft, { firmGstin: FIRM_GSTIN, matcher: null, today: "2026-10-15" }, out.extraction.issues).issues.map((i) => i.code);
    };
    assert.ok((await get("145 Y PRISTAGE.pdf")).includes("LINE_RATE_OVERFLOW"));
    assert.ok((await get("198.pdf")).includes("LINE_RATE_OVERFLOW"));
    assert.ok((await get("189.pdf")).includes("GSTIN_INVALID"));
    assert.ok((await get("213.pdf")).includes("LINE_DESCRIPTION_MERGED"));
  });
});
