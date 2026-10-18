/** Document numbering on a throwaway PGlite database. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

describe("document numbering", { timeout: 120_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "numbering-test-"));
  let prisma: typeof import("../../src/lib/prisma").prisma;
  let seq: typeof import("../../src/lib/sequence");
  const firmId = "firm_numbering";

  before(async () => {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DIR = dir;
    ({ prisma } = await import("../../src/lib/prisma"));
    seq = await import("../../src/lib/sequence");
    await prisma.firm.create({ data: { id: firmId, code: "TT", name: "Test", gstin: "29FMKPM8993P1ZI" } });
  });
  after(async () => {
    await prisma?.$disconnect().catch(() => {});
    await (globalThis as { pgliteInstance?: { close(): Promise<void> } }).pgliteInstance?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the prefix + 4 digits form for ordinary templates", async () => {
    assert.equal(await seq.nextDocumentNumber(firmId, "quotation", "NON_GST"), `QT/QT/${seq.financialYearFor()}/0001`);
  });

  it("issues plain unpadded numbers from a {N} template, continuing from the counter floor", async () => {
    await prisma.setting.createMany({
      data: [
        { firmId, key: "sequence_invoice_gst", value: "{N}", category: "documents" },
        { firmId, key: "sequence_quotation", value: "{N}", category: "documents" },
      ],
    });
    const fy = seq.financialYearFor();
    await seq.syncDocumentSequenceFloor(firmId, "invoice", "GST", fy, 216);
    await seq.syncDocumentSequenceFloor(firmId, "quotation", "NON_GST", fy, 186);
    assert.equal(await seq.nextDocumentNumber(firmId, "invoice", "GST"), "217");
    assert.equal(await seq.nextDocumentNumber(firmId, "invoice", "GST"), "218");
    assert.equal(await seq.nextDocumentNumber(firmId, "quotation", "NON_GST"), "187");
    assert.equal(await seq.nextDocumentNumber(firmId, "quotation", "NON_GST"), "188");
  });
});
