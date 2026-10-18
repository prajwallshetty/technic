/**
 * Runs the bulk invoice extraction pipeline over a ZIP or folder of invoices
 * and writes a machine-readable report — without touching the database
 * unless --catalog=db is given (read-only: products and aliases).
 *
 *   npm run invoice-import:report -- [--source public/technic.zip] [--catalog none|db|<file.json>]
 *                                    [--firm-gstin 29FMKPM8993P1ZI] [--ground-truth data/invoice-import/ground-truth.json]
 *                                    [--out reports/invoice-import]
 *
 * Outputs (gitignored — they contain customer data):
 *   extraction-report.json   full extraction, validation and matching per document
 *   extraction-report.csv    one row per document (Phase 5 columns)
 *   extraction-lines.csv     one row per line item
 *   ground-truth-comparison.json  field-level comparison against manually verified data
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ProductMatcher, type CatalogueProduct, type ProductAlias } from "../src/lib/invoice-import/matching";
import { compactKey, nearlyEqual } from "../src/lib/invoice-import/normalize";
import { evaluateDraft, extractDocument } from "../src/lib/invoice-import/pipeline";
import { detectMimeType, isZip, readZip, type ArchiveFile } from "../src/lib/invoice-import/zip";
import type { DraftInvoice } from "../src/lib/invoice-import/draft";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const [key, inline] = arg.slice(2).split("=");
  args.set(key, inline ?? (process.argv[i + 1]?.startsWith("--") ? "true" : (process.argv[++i] ?? "true")));
}

const source = args.get("source") ?? "public/technic.zip";
const catalogArg = args.get("catalog") ?? "none";
const outDir = args.get("out") ?? "reports/invoice-import";
const groundTruthPath = args.get("ground-truth") ?? "data/invoice-import/ground-truth.json";
const today = args.get("today") ?? new Date().toISOString().slice(0, 10);

async function loadCatalogue(): Promise<{ products: CatalogueProduct[]; aliases: ProductAlias[]; firmGstin: string | null; label: string }> {
  if (catalogArg === "none") return { products: [], aliases: [], firmGstin: null, label: "none (matching skipped)" };
  if (catalogArg !== "db") {
    const json = JSON.parse(fs.readFileSync(catalogArg, "utf8"));
    // Catalogue exports without ids (e.g. data/historical-csv/catalog-products.json) are keyed by SKU.
    const products = ((json.products ?? json) as CatalogueProduct[]).map((p) => ({ ...p, id: p.id ?? p.sku }));
    return { products, aliases: json.aliases ?? [], firmGstin: json.firmGstin ?? null, label: `file ${catalogArg} (${products.length} products)` };
  }
  const { prisma } = await import("../src/lib/prisma");
  const firmId = args.get("firm-id");
  const firm = firmId
    ? await prisma.firm.findUnique({ where: { id: firmId } })
    : await prisma.firm.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  if (!firm) throw new Error("No firm found in the database");
  const products = await prisma.product.findMany({
    where: { firmId: firm.id },
    select: { id: true, sku: true, name: true, subName: true, barcode: true, modelNumber: true, partNumber: true, hsnCode: true, status: true },
  });
  let aliases: ProductAlias[] = [];
  try {
    aliases = (await prisma.invoiceImportProductAlias.findMany({ where: { firmId: firm.id } })).map((a) => ({
      aliasKey: a.aliasKey,
      productId: a.productId,
      partyKey: a.partyKey,
    }));
  } catch {
    // Table not migrated yet — matching still works without aliases.
  }
  return { products, aliases, firmGstin: firm.gstin, label: `database firm ${firm.code} (${products.length} products, ${aliases.length} aliases)` };
}

function collectFiles(): { files: ArchiveFile[]; skipped: Array<{ path: string; reason: string }> } {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    const files = fs
      .readdirSync(source)
      .filter((f) => fs.statSync(path.join(source, f)).isFile())
      .map((f) => ({ path: f, name: f, data: fs.readFileSync(path.join(source, f)) }));
    return { files, skipped: [] };
  }
  const data = fs.readFileSync(source);
  if (isZip(data)) return readZip(data);
  return { files: [{ path: path.basename(source), name: path.basename(source), data }], skipped: [] };
}

function csv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          if (value === null || value === undefined) return "";
          const s = String(value);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n") + "\n";
}

async function main() {
  const catalogue = await loadCatalogue();
  const firmGstin = args.get("firm-gstin") ?? catalogue.firmGstin ?? "29FMKPM8993P1ZI";
  const matcher = catalogArg === "none" ? null : new ProductMatcher(catalogue.products, catalogue.aliases);
  const { files, skipped } = collectFiles();

  console.log(`Source: ${source}`);
  console.log(`Files in archive: ${files.length} (+${skipped.length} skipped)`);
  console.log(`Catalogue: ${catalogue.label}`);
  console.log(`Firm GSTIN: ${firmGstin}\n`);

  // De-duplicate identical files (the nested 186.zip repeats every PDF).
  const byHash = new Map<string, ArchiveFile[]>();
  for (const file of files) {
    const hash = crypto.createHash("sha256").update(file.data).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
  }

  const documents: Array<Record<string, unknown>> = [];
  const drafts = new Map<string, DraftInvoice>();
  const seenInvoiceKeys = new Map<string, string>();

  for (const [hash, copies] of byHash) {
    const file = copies[0];
    const duplicatesOf = copies.slice(1).map((c) => c.path);
    const mimeType = detectMimeType(file.data, file.name);
    const base = { sourceFilename: file.name, sourcePath: file.path, sha256: hash, identicalCopies: duplicatesOf };
    if (!mimeType || !["application/pdf", "image/png", "image/jpeg", "image/tiff"].includes(mimeType)) {
      documents.push({ ...base, status: "UNSUPPORTED", errors: [`Unsupported file type (${mimeType ?? "unknown"})`] });
      continue;
    }
    try {
      const started = Date.now();
      const out = await extractDocument(file.data, { sourceFilename: file.name, mimeType, firmGstin });
      const evaluation = evaluateDraft(out.draft, { firmGstin, matcher, today }, out.extraction.issues);
      const draft = out.draft;
      drafts.set(file.name, draft);

      const issues = [...evaluation.issues];
      const invoiceKey = `${draft.direction}|${draft.partyGstin ?? compactKey(draft.partyName)}|${draft.invoiceNumber}`;
      const numberKey = `${draft.direction}|${draft.invoiceNumber}`;
      if (seenInvoiceKeys.has(numberKey)) {
        issues.push({
          code: "DUPLICATE_INVOICE_NUMBER",
          severity: "ERROR",
          message: `Invoice number ${draft.invoiceNumber} also appears in ${seenInvoiceKeys.get(numberKey)}`,
          field: "invoiceNumber",
        });
      } else seenInvoiceKeys.set(numberKey, file.name);

      const missing = issues.filter((i) => i.code === "REQUIRED_FIELD_MISSING").map((i) => i.field);
      const errors = issues.filter((i) => i.severity === "ERROR");
      const warnings = issues.filter((i) => i.severity === "WARNING");
      const blocking = errors.filter((i) => !(matcher === null && i.code === "PRODUCT_NOT_FOUND"));
      documents.push({
        ...base,
        mimeType,
        pageCount: out.text.pageCount,
        extractionMethod: out.text.method,
        layoutId: out.extraction.layoutId,
        documentType: draft.documentType,
        direction: draft.direction,
        issuer: draft.issuerName,
        party: draft.partyName,
        partyGstin: draft.partyGstin,
        invoiceNumber: draft.invoiceNumber,
        invoiceDate: draft.invoiceDate,
        paymentTerms: draft.paymentTerms,
        currency: draft.currency,
        lineCount: draft.lines.length,
        itemLines: evaluation.summary.itemLines,
        adjustmentLines: evaluation.summary.adjustmentLines,
        matchedProducts: evaluation.summary.matched,
        suggestedProducts: evaluation.summary.suggested,
        unmatchedProducts: evaluation.summary.unmatched,
        missingRequiredFields: missing,
        extractedGrandTotal: draft.totals.grandTotal,
        calculatedGrandTotal: evaluation.reconciliation.calculated.grandTotal,
        grandTotalDifference: evaluation.reconciliation.grandTotalDifference,
        validationDifferences: evaluation.reconciliation.checks.filter((c) => c.ok === false),
        confidence: evaluation.confidence,
        status: blocking.length ? "NEEDS_REVIEW" : "READY_FOR_APPROVAL",
        errors: errors.map((i) => `${i.code}: ${i.message}`),
        warnings: warnings.map((i) => `${i.code}: ${i.message}`),
        info: issues.filter((i) => i.severity === "INFO").map((i) => `${i.code}: ${i.message}`),
        processingMs: Date.now() - started,
        invoiceKey,
        draft,
        matches: evaluation.matches,
        checks: evaluation.reconciliation.checks,
      });
    } catch (error) {
      documents.push({ ...base, mimeType, status: "FAILED", errors: [error instanceof Error ? `${error.name}: ${error.message}` : String(error)] });
    }
  }

  documents.sort((a, b) => String(a.sourceFilename).localeCompare(String(b.sourceFilename), undefined, { numeric: true }));
  fs.mkdirSync(outDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    source,
    catalogue: catalogue.label,
    filesInArchive: files.length,
    uniqueDocuments: byHash.size,
    identicalDuplicateFiles: files.length - byHash.size,
    skippedEntries: skipped,
    byStatus: countBy(documents, (d) => String(d.status)),
    byDirection: countBy(documents, (d) => String(d.direction ?? "—")),
    byExtractionMethod: countBy(documents, (d) => String(d.extractionMethod ?? "—")),
    totalLines: documents.reduce((n, d) => n + Number(d.lineCount ?? 0), 0),
    grandTotalsReconciled: documents.filter((d) => d.grandTotalDifference === 0).length,
    grandTotalsDiffering: documents.filter((d) => typeof d.grandTotalDifference === "number" && d.grandTotalDifference !== 0).length,
    issueCounts: countBy(
      documents.flatMap((d) => [...((d.errors as string[]) ?? []), ...((d.warnings as string[]) ?? []), ...((d.info as string[]) ?? [])]),
      (s) => s.split(":")[0],
    ),
  };

  fs.writeFileSync(path.join(outDir, "extraction-report.json"), JSON.stringify({ summary, documents }, null, 2));
  fs.writeFileSync(
    path.join(outDir, "extraction-report.csv"),
    csv([
      [
        "source_filename", "document_type", "direction", "party", "party_gstin", "invoice_number", "invoice_date", "payment_terms",
        "line_items", "item_lines", "matched_products", "suggested_products", "unmatched_products", "missing_required_fields",
        "extracted_grand_total", "calculated_grand_total", "grand_total_difference", "validation_differences",
        "status", "confidence", "errors", "warnings", "identical_copies",
      ],
      ...documents.map((d) => [
        d.sourceFilename, d.documentType, d.direction, d.party, d.partyGstin, d.invoiceNumber, d.invoiceDate, d.paymentTerms,
        d.lineCount, d.itemLines, d.matchedProducts, d.suggestedProducts, d.unmatchedProducts, ((d.missingRequiredFields as string[]) ?? []).join("; "),
        d.extractedGrandTotal, d.calculatedGrandTotal, d.grandTotalDifference,
        ((d.validationDifferences as Array<{ label: string; difference: number }>) ?? []).map((c) => `${c.label} (${c.difference})`).join("; "),
        d.status, d.confidence, ((d.errors as string[]) ?? []).join(" | "), ((d.warnings as string[]) ?? []).join(" | "),
        ((d.identicalCopies as string[]) ?? []).join("; "),
      ]),
    ]),
  );
  fs.writeFileSync(
    path.join(outDir, "extraction-lines.csv"),
    csv([
      ["source_filename", "invoice_number", "line_no", "kind", "description", "hsn", "quantity", "unit", "gst_rate", "rate", "amount", "match_status", "match_method", "product_id", "match_confidence", "top_candidate", "raw_text"],
      ...documents.flatMap((d) => {
        const draft = d.draft as DraftInvoice | undefined;
        if (!draft) return [];
        const matches = d.matches as Array<{ lineNo: number; match: { status: string; method: string | null; productId: string | null; confidence: number; candidates: Array<{ name: string; score: number }> } }>;
        return draft.lines.map((l) => {
          const m = matches.find((x) => x.lineNo === l.lineNo)?.match;
          return [d.sourceFilename, draft.invoiceNumber, l.lineNo, l.kind, l.description, l.hsn, l.quantity, l.unit, l.gstRate, l.rate, l.amount, m?.status, m?.method, m?.productId, m?.confidence, m?.candidates[0] ? `${m.candidates[0].name} (${m.candidates[0].score})` : "", l.rawText];
        });
      }),
    ]),
  );

  console.log(JSON.stringify(summary, null, 2));

  if (fs.existsSync(groundTruthPath)) {
    const comparison = compareWithGroundTruth(JSON.parse(fs.readFileSync(groundTruthPath, "utf8")), drafts);
    fs.writeFileSync(path.join(outDir, "ground-truth-comparison.json"), JSON.stringify(comparison, null, 2));
    console.log("\nGround-truth comparison:");
    console.log(JSON.stringify(comparison.summary, null, 2));
    if (comparison.mismatches.length) console.log("Mismatches:", JSON.stringify(comparison.mismatches, null, 2));
  } else {
    console.log(`\nNo ground truth at ${groundTruthPath}; accuracy not measured.`);
  }
  console.log(`\nReports written to ${outDir}/`);
}

type GtLine = [string, string, string | null, number, string | null, number, number | null, number];
interface GtInvoice {
  file: string;
  invoiceNumber: string;
  invoiceDate: string;
  paymentTerms: string;
  customerName: string;
  customerGstin: string | null;
  customerPhone: string | null;
  lines: GtLine[];
  totals: Record<string, number | null>;
}

function compareWithGroundTruth(gt: { invoices: GtInvoice[] }, drafts: Map<string, DraftInvoice>) {
  const fieldStats = new Map<string, { checked: number; correct: number }>();
  const mismatches: Array<{ file: string; field: string; expected: unknown; actual: unknown }> = [];
  const record = (file: string, fieldName: string, expected: unknown, actual: unknown) => {
    const stat = fieldStats.get(fieldName) ?? { checked: 0, correct: 0 };
    stat.checked++;
    const same =
      typeof expected === "number" && typeof actual === "number" ? nearlyEqual(expected, actual, 0.001) : (expected ?? null) === (actual ?? null);
    if (same) stat.correct++;
    else mismatches.push({ file, field: fieldName, expected, actual });
    fieldStats.set(fieldName, stat);
  };

  for (const inv of gt.invoices) {
    const draft = drafts.get(inv.file);
    if (!draft) {
      mismatches.push({ file: inv.file, field: "document", expected: "extracted", actual: "missing" });
      continue;
    }
    record(inv.file, "invoiceNumber", inv.invoiceNumber, draft.invoiceNumber);
    record(inv.file, "invoiceDate", inv.invoiceDate, draft.invoiceDate);
    record(inv.file, "paymentTerms", inv.paymentTerms, draft.paymentTerms);
    record(inv.file, "customerName", inv.customerName, draft.partyName);
    record(inv.file, "customerGstin", inv.customerGstin, draft.partyGstin);
    record(inv.file, "customerPhone", inv.customerPhone, draft.partyPhone);
    for (const [key, value] of Object.entries(inv.totals)) {
      record(inv.file, `totals.${key}`, value, draft.totals[key as keyof typeof draft.totals]);
    }
    record(inv.file, "lineCount", inv.lines.length, draft.lines.length);
    inv.lines.forEach((expected, index) => {
      const actual = draft.lines[index];
      const [kind, description, hsn, quantity, unit, gstRate, rate, amount] = expected;
      const prefix = "line.";
      record(inv.file, `${prefix}kind`, kind, actual?.kind);
      record(inv.file, `${prefix}description`, description, actual?.description);
      record(inv.file, `${prefix}hsn`, hsn, actual?.hsn);
      record(inv.file, `${prefix}quantity`, quantity, actual?.quantity);
      record(inv.file, `${prefix}unit`, unit, actual?.unit);
      record(inv.file, `${prefix}gstRate`, gstRate, actual?.gstRate);
      record(inv.file, `${prefix}rate`, rate, actual?.rate);
      record(inv.file, `${prefix}amount`, amount, actual?.amount);
    });
  }

  const perField = Object.fromEntries(
    [...fieldStats].map(([k, v]) => [k, { ...v, accuracy: Math.round((v.correct / v.checked) * 10000) / 100 }]),
  );
  const checked = [...fieldStats.values()].reduce((n, v) => n + v.checked, 0);
  const correct = [...fieldStats.values()].reduce((n, v) => n + v.correct, 0);
  return {
    summary: {
      invoicesCompared: gt.invoices.length,
      fieldsChecked: checked,
      fieldsCorrect: correct,
      fieldAccuracyPercent: Math.round((correct / checked) * 10000) / 100,
      note: "Measured only on the manually verified sample listed in the ground-truth file, not on all documents.",
      perField,
    },
    mismatches,
  };
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (catalogArg === "db") {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  }
});
