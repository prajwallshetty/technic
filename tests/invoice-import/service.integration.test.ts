/**
 * End-to-end test of the import service on a throwaway PGlite database
 * (never the configured DATABASE_URL), using the real invoices.
 *
 * Two firms are set up:
 *  - Technic Technology (29FMKPM8993P1ZI): the invoices are its own SALES
 *    invoices, so approval must only mark them approved.
 *  - Shah Enterprises (29ETNPS4644J1ZS): a real customer on those invoices,
 *    for whom the same PDFs are genuine supplier (PURCHASE) invoices — this
 *    exercises the draft purchase-order path without inventing documents.
 *
 * Catalogue: the committed data/historical-csv/catalog-products.json.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const ZIP = "public/technic.zip";
const available = fs.existsSync(ZIP);

describe("invoice import service (PGlite)", { skip: !available && "public/technic.zip not present", timeout: 600_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-import-test-"));
  let prisma: typeof import("../../src/lib/prisma").prisma;
  let svc: typeof import("../../src/lib/services/invoice-imports");
  const ids = { technic: "firm_test_technic", shah: "firm_test_shah", technicBranch: "", shahBranch: "", user: "", supplier: "" };
  let technicBatchId = "";

  before(async () => {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DIR = dir;
    ({ prisma } = await import("../../src/lib/prisma"));
    svc = await import("../../src/lib/services/invoice-imports");

    await prisma.firm.create({ data: { id: ids.technic, code: "TT", name: "Technic Technology", gstin: "29FMKPM8993P1ZI", state: "Karnataka" } });
    await prisma.firm.create({ data: { id: ids.shah, code: "SE", name: "Shah Enterprises", gstin: "29ETNPS4644J1ZS", state: "Karnataka" } });
    ids.technicBranch = (await prisma.branch.create({ data: { firmId: ids.technic, code: "MLR", name: "Mangaluru", type: "HEAD_OFFICE", state: "Karnataka" } })).id;
    ids.shahBranch = (await prisma.branch.create({ data: { firmId: ids.shah, code: "KNK", name: "Kankanady", type: "HEAD_OFFICE", state: "Karnataka" } })).id;
    ids.user = (await prisma.user.create({ data: { name: "Reviewer", email: "reviewer@test.local", accessCode: "990001", role: "ADMIN", firmId: ids.technic } })).id;
    ids.supplier = (
      await prisma.supplier.create({ data: { firmId: ids.shah, code: "SUP-0001", name: "TECHNIC TECHNOLOGY", gstin: "29FMKPM8993P1ZI", state: "Karnataka" } })
    ).id;

    const catalogue = JSON.parse(fs.readFileSync("data/historical-csv/catalog-products.json", "utf8")) as Array<{ sku: string; name: string; hsn: string; gst: number; rate: number }>;
    for (const firmId of [ids.technic, ids.shah]) {
      await prisma.product.createMany({
        data: catalogue.map((p) => ({ firmId, sku: p.sku, name: p.name, hsnCode: p.hsn, gstRate: p.gst, sellingPrice: p.rate, purchasePrice: p.rate })),
      });
    }
  });

  after(async () => {
    await prisma?.$disconnect().catch(() => {});
    // Close PGlite before deleting its directory, or its exit-time flush fails.
    await (globalThis as { pgliteInstance?: { close(): Promise<void> } }).pgliteInstance?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uploads the ZIP, de-duplicates the nested copy and processes every document", async () => {
    const result = await svc.createImportBatch(
      { firmId: ids.technic, userId: ids.user, branchId: ids.technicBranch, name: "technic.zip" },
      [{ filename: "technic.zip", data: fs.readFileSync(ZIP) }],
    );
    technicBatchId = result.batchId;
    assert.equal(result.queued, 81);
    assert.equal(result.skipped.filter((s) => /Identical to/.test(s.reason)).length, 81);

    let progress;
    do {
      progress = await svc.processQueuedDocuments({ firmId: ids.technic, batchId: technicBatchId, limit: 100, timeBudgetMs: 300_000 });
    } while (progress.remaining > 0);

    const p = await svc.getBatchProgress(ids.technic, technicBatchId);
    assert.equal(p.status, "COMPLETED");
    assert.equal(p.total, 81);
    assert.equal(p.counts.FAILED ?? 0, 0);

    const docs = await prisma.invoiceImportDocument.findMany({ where: { batchId: technicBatchId } });
    // 147 ms bat.pdf and 148.pdf both print invoice number 148.
    const dup = docs.filter((d) => d.invoiceNumber === "148");
    assert.equal(dup.length, 2);
    assert.ok(dup.every((d) => d.status === "DUPLICATE"));
    assert.ok(docs.every((d) => d.direction === "SALES"));
  });

  it("re-uploading the same ZIP queues nothing new", async () => {
    const result = await svc.createImportBatch({ firmId: ids.technic, userId: ids.user, branchId: ids.technicBranch }, [
      { filename: "technic.zip", data: fs.readFileSync(ZIP) },
    ]);
    assert.equal(result.queued, 0);
    assert.equal(result.duplicates, 81);
  });

  it("approves a reviewed sales invoice without creating ERP invoices, stock or payments", async () => {
    const doc = await prisma.invoiceImportDocument.findFirstOrThrow({ where: { batchId: technicBatchId, sourceFilename: "136.pdf" } });
    assert.equal(doc.status, "READY");
    const result = await svc.approveDocument({ firmId: ids.technic, userId: ids.user, branchId: ids.technicBranch, canCreatePurchase: true }, doc.id);
    assert.equal(result.status, "APPROVED");
    assert.equal(await prisma.invoice.count(), 0);
    assert.equal(await prisma.stockTransaction.count(), 0);
    assert.equal(await prisma.payment.count(), 0);
    await assert.rejects(
      svc.approveDocument({ firmId: ids.technic, userId: ids.user, branchId: ids.technicBranch, canCreatePurchase: true }, doc.id),
      /cannot be approved/,
    );
  });

  it("blocks approval of a duplicate invoice number", async () => {
    const doc = await prisma.invoiceImportDocument.findFirstOrThrow({ where: { batchId: technicBatchId, sourceFilename: "148.pdf" } });
    await assert.rejects(
      svc.approveDocument({ firmId: ids.technic, userId: ids.user, branchId: ids.technicBranch, canCreatePurchase: true }, doc.id),
      /Invoice number 148/,
    );
  });

  it("records corrections in the audit log and re-validates them", async () => {
    const doc = await prisma.invoiceImportDocument.findFirstOrThrow({ where: { batchId: technicBatchId, sourceFilename: "137.pdf" } });
    const draft = doc.draft as never as import("../../src/lib/invoice-import/draft").DraftInvoice;
    const edited = { ...draft, totals: { ...draft.totals, grandTotal: (draft.totals.grandTotal ?? 0) + 100 } };
    const result = await svc.saveReview({ firmId: ids.technic, userId: ids.user }, doc.id, { draft: edited, productAssignments: {} });
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.ok(result.evaluation.issues.some((i) => i.code === "GRAND_TOTAL_MISMATCH"));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: doc.id, action: "INVOICE_IMPORT_EDITED" } });
    assert.deepEqual((audit.after as Record<string, unknown>)["totals.grandTotal"], (draft.totals.grandTotal ?? 0) + 100);
    // The original extraction is untouched.
    const reloaded = await prisma.invoiceImportDocument.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal((reloaded.extraction as { totals: { grandTotal: { value: number } } }).totals.grandTotal.value, draft.totals.grandTotal);
  });

  it("turns an approved supplier invoice into a DRAFT purchase order — no stock movement", async () => {
    const pdf = readZipFile("158.pdf");
    const batch = await svc.createImportBatch({ firmId: ids.shah, userId: ids.user, branchId: ids.shahBranch }, [{ filename: "158.pdf", data: pdf }]);
    await svc.processQueuedDocuments({ firmId: ids.shah, batchId: batch.batchId, limit: 5 });
    const doc = await prisma.invoiceImportDocument.findFirstOrThrow({ where: { batchId: batch.batchId } });
    assert.equal(doc.direction, "PURCHASE");
    assert.equal((doc.assignments as { supplierId: string }).supplierId, ids.supplier);
    assert.equal(doc.status, "READY", JSON.stringify((doc.evaluation as { issues: unknown[] }).issues));

    const actor = { firmId: ids.shah, userId: ids.user, branchId: ids.shahBranch, canCreatePurchase: true };
    let result;
    try {
      result = await svc.approveDocument(actor, doc.id);
    } catch (error) {
      // The ERP prices lines GST-inclusive and stores discount % to 2 decimals;
      // if that moves the total by more than ₹1 the reviewer must accept it.
      assert.match(String(error), /DRAFT_TOTAL_DIFFERENCE|would total/);
      await svc.acknowledgeIssue(actor, doc.id, "DRAFT_TOTAL_DIFFERENCE", "totals.grandTotal", "ERP rounding of 1% discount accepted");
      result = await svc.approveDocument(actor, doc.id);
    }
    assert.equal(result.status, "POSTED");
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: result.postedEntityId! }, include: { items: true } });
    assert.equal(po.status, "DRAFT");
    assert.equal(po.items.length, 21);
    assert.ok(Math.abs(Number(po.total) - 102936) <= 2, `PO total ${po.total}`);
    assert.equal(await prisma.stockTransaction.count({ where: { firmId: ids.shah } }), 0);
    assert.equal(await prisma.purchaseInvoice.count({ where: { firmId: ids.shah } }), 0);

    // The same invoice uploaded again can never be approved twice.
    const again = await svc.createImportBatch({ firmId: ids.shah, userId: ids.user, branchId: ids.shahBranch }, [
      { filename: "copy-of-158.pdf", data: Buffer.concat([pdf, Buffer.from("\n")]) },
    ]);
    await svc.processQueuedDocuments({ firmId: ids.shah, batchId: again.batchId, limit: 5 });
    const second = await prisma.invoiceImportDocument.findFirstOrThrow({ where: { batchId: again.batchId } });
    assert.equal(second.status, "DUPLICATE");
    await assert.rejects(svc.approveDocument(actor, second.id), /Invoice number 158|already been approved/);
  });

  it("refuses to approve a supplier invoice for a user without purchase.create", async () => {
    const batch = await svc.createImportBatch({ firmId: ids.shah, userId: ids.user, branchId: ids.shahBranch }, [{ filename: "160.pdf", data: readZipFile("160.pdf") }]);
    await svc.processQueuedDocuments({ firmId: ids.shah, batchId: batch.batchId, limit: 5 });
    const doc = await prisma.invoiceImportDocument.findFirstOrThrow({ where: { batchId: batch.batchId } });
    await assert.rejects(
      svc.approveDocument({ firmId: ids.shah, userId: ids.user, branchId: ids.shahBranch, canCreatePurchase: false }, doc.id),
      /purchase\.create/,
    );
  });

  it("keeps firms isolated", async () => {
    const technicDoc = await prisma.invoiceImportDocument.findFirstOrThrow({ where: { firmId: ids.technic } });
    await assert.rejects(svc.getDocumentForReview(ids.shah, technicDoc.id), /not found/);
  });
});

function readZipFile(name: string): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readZip } = require("../../src/lib/invoice-import/zip") as typeof import("../../src/lib/invoice-import/zip");
  const file = readZip(fs.readFileSync(ZIP)).files.find((f) => f.name === name && !f.path.includes("186.zip!/"));
  if (!file) throw new Error(`${name} not in archive`);
  return file.data;
}
