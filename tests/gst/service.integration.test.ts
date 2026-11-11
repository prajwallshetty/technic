/**
 * Credit/debit notes, GST corrections and the full GSTR-1 pipeline on a
 * throwaway PGlite database, with synthetic data only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const CS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(state: string, seed: string) {
  const base = `${state}${seed.padEnd(5, "A").slice(0, 5)}1234F1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const p = CS.indexOf(base[i]) * (i % 2 ? 2 : 1); t += Math.floor(p / 36) + (p % 36); }
  return base + CS[(36 - (t % 36)) % 36];
}

describe("credit notes + GSTR-1 pipeline (PGlite)", { timeout: 180_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gst-int-"));
  let prisma: typeof import("../../src/lib/prisma").prisma;
  let notes: typeof import("../../src/lib/services/credit-notes");
  let fixes: typeof import("../../src/lib/services/gst-corrections");
  let load: typeof import("../../src/lib/gst/gstr1/load");
  let report: typeof import("../../src/lib/gst/gstr1/report");
  const FIRM = gstin("29", "FIRMA"), BUYER = gstin("29", "BUYER");
  const ids = { firm: "firm_gst_test", branch: "", c1: "", c2: "", product: "", inv1: "", inv1Line: "", inv2: "", inv3: "", user: "" };

  before(async () => {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DIR = dir;
    ({ prisma } = await import("../../src/lib/prisma"));
    notes = await import("../../src/lib/services/credit-notes");
    fixes = await import("../../src/lib/services/gst-corrections");
    load = await import("../../src/lib/gst/gstr1/load");
    report = await import("../../src/lib/gst/gstr1/report");

    await prisma.firm.create({ data: { id: ids.firm, code: "TT", name: "Test Firm", legalName: "Test Firm Pvt Ltd", gstin: FIRM, state: "Karnataka", stateCode: "29" } });
    ids.branch = (await prisma.branch.create({ data: { firmId: ids.firm, code: "HO", name: "HO", type: "HEAD_OFFICE", state: "Karnataka" } })).id;
    ids.user = (await prisma.user.create({ data: { name: "U", email: "u@t.local", accessCode: "880001", role: "ADMIN", firmId: ids.firm } })).id;
    ids.c1 = (await prisma.customer.create({ data: { firmId: ids.firm, code: "C1", branchId: ids.branch, name: "Registered Co", phone: "9000000001", gstin: BUYER, state: "Karnataka" } })).id;
    ids.c2 = (await prisma.customer.create({ data: { firmId: ids.firm, code: "C2", branchId: ids.branch, name: "Walk-in", phone: "9000000002" } })).id;
    ids.product = (await prisma.product.create({ data: { firmId: ids.firm, sku: "P1", name: "Battery", unit: "pcs", gstRate: 18 } })).id;

    const mk = async (n: string, customerId: string, name: string, gst: string | null, pos: string | null, date: string, qty: number, withHsn: boolean) => {
      const taxable = qty * 100, tax = taxable * 0.09;
      const inv = await prisma.invoice.create({
        data: {
          firmId: ids.firm, branchId: ids.branch, customerId, invoiceNumber: n, kind: "TAX_INVOICE", taxMode: "GST", status: "ISSUED", invoiceDate: new Date(`${date}T00:00:00+05:30`),
          billToName: name, billToGstin: gst, placeOfSupply: pos ? "Karnataka" : null, placeOfSupplyCode: pos, subtotal: taxable, taxableAmount: taxable, cgstAmount: tax, sgstAmount: tax,
          totalAmount: taxable + 2 * tax, amountDue: taxable + 2 * tax,
          lines: { create: [{ productId: ids.product, description: "Battery", hsnCode: withHsn ? "85071000" : null, quantity: qty, unitPrice: 100, gstRate: 18, taxableValue: taxable, cgstAmount: tax, sgstAmount: tax, lineTotal: taxable + 2 * tax }] },
        },
        include: { lines: true },
      });
      return inv;
    };
    const i1 = await mk("101", ids.c1, "Registered Co", BUYER, "29", "2026-09-05", 10, true);
    ids.inv1 = i1.id; ids.inv1Line = i1.lines[0].id;
    ids.inv2 = (await mk("102", ids.c2, "Walk-in", null, null, "2026-09-06", 5, false)).id;
    ids.inv3 = (await mk("103", ids.c2, "Walk-in", null, "29", "2026-09-07", 3, true)).id;
    await prisma.customer.update({ where: { id: ids.c1 }, data: { totalBilled: 1180, outstandingAmount: 1180, invoiceCount: 1 } });
  });

  after(async () => {
    await prisma?.$disconnect().catch(() => {});
    await (globalThis as { pgliteInstance?: { close(): Promise<void> } }).pgliteInstance?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const actor = () => ({ firmId: ids.firm, userId: ids.user });
  const buildReport = async () => report.buildGstr1(await load.loadGstr1Input({ firmId: ids.firm, from: "2026-09-01", to: "2026-09-30" }));
  const codes = (r: Awaited<ReturnType<typeof buildReport>>, c: string) => r.issues.filter((i) => i.code === c);

  it("reads real records and reconciles; flags the invoice with no place of supply and no HSN", async () => {
    const r = await buildReport();
    assert.deepEqual(r.reconciliation.filter((x) => x.ok === false).map((x) => x.key), []);
    assert.equal(r.totals.invoiceCount, 3);
    assert.equal(r.totals.b2b.invoices, 1);
    assert.equal(codes(r, "POS_MISSING").length, 1);
    assert.equal(codes(r, "POS_MISSING")[0].docNumber, "102");
    assert.equal(codes(r, "HSN_MISSING").length, 1);
    assert.equal(codes(r, "HSN_MISSING")[0].productId, ids.product);
    assert.ok(codes(r, "HSN_MISSING")[0].lineId);
  });

  it("corrections change classification only, are audited, and clear the findings", async () => {
    await assert.rejects(fixes.updateInvoiceGstDetails(actor(), ids.inv2, { placeOfSupplyCode: "99" }), /not a place-of-supply code/);
    await assert.rejects(fixes.updateInvoiceGstDetails(actor(), ids.inv1, { billToGstin: BUYER.slice(0, 14) + (BUYER[14] === "A" ? "B" : "A") }), /not valid/);
    const before = await prisma.invoice.findUniqueOrThrow({ where: { id: ids.inv2 } });
    await fixes.updateInvoiceGstDetails(actor(), ids.inv2, { placeOfSupplyCode: "29" });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: ids.inv2 } });
    assert.equal(after.placeOfSupply, "Karnataka");
    assert.equal(Number(after.totalAmount), Number(before.totalAmount), "amounts untouched");
    assert.equal(Number(after.taxableAmount), Number(before.taxableAmount));

    await assert.rejects(fixes.setHsnForProductLines(actor(), ids.product, { hsnCode: "850" }), /2, 4, 6 or 8 digit/);
    const res = await fixes.setHsnForProductLines(actor(), ids.product, { hsnCode: "85071000", uqc: "PCS", updateProduct: true });
    assert.equal(res.updated, 1, "only the line with no HSN is changed");
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: ids.product } })).hsnCode, "85071000");
    const audits = await prisma.auditLog.count({ where: { action: "INVOICE_GST_UPDATED" } });
    assert.ok(audits >= 2);
    const r = await buildReport();
    assert.equal(codes(r, "POS_MISSING").length + codes(r, "HSN_MISSING").length, 0);
  });

  let noteId = "";
  it("issues a credit note that mirrors the invoice line, with a short numbered series and a ledger entry", async () => {
    const note = await notes.createCreditDebitNote({ firmId: ids.firm, branchId: ids.branch, noteType: "CREDIT", noteDate: new Date("2026-09-12T10:00:00+05:30"), customerId: ids.c1, originalInvoiceId: ids.inv1, reason: "SALES_RETURN", lines: [{ invoiceLineId: ids.inv1Line, quantity: 2 }], userId: ids.user });
    noteId = note.id;
    assert.match(note.noteNumber, /^CN\/26-27\/1$/);
    assert.ok(note.noteNumber.length <= 16);
    assert.deepEqual([Number(note.taxableAmount), Number(note.cgstAmount), Number(note.sgstAmount), Number(note.totalAmount)], [200, 18, 18, 236]);
    assert.equal(note.placeOfSupplyCode, "29");
    assert.equal(note.originalInvoiceNumber, "101");
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: ids.c1 } });
    assert.equal(Number(customer.outstandingAmount), 1180 - 236, "the customer owes less");
    assert.equal(await prisma.journalEntry.count({ where: { reference: note.id, type: "CREDIT_ADJUSTMENT" } }), 1);
    assert.equal(await prisma.stockTransaction.count(), 0, "a note never moves stock");
  });

  it("refuses to over-credit an invoice line, or to credit across customers or dates", async () => {
    await assert.rejects(notes.createCreditDebitNote({ firmId: ids.firm, branchId: ids.branch, noteType: "CREDIT", customerId: ids.c1, originalInvoiceId: ids.inv1, reason: "SALES_RETURN", lines: [{ invoiceLineId: ids.inv1Line, quantity: 9 }] }), /only 8 .* can still be credited/);
    await assert.rejects(notes.createCreditDebitNote({ firmId: ids.firm, branchId: ids.branch, noteType: "CREDIT", customerId: ids.c2, originalInvoiceId: ids.inv1, reason: "OTHERS", lines: [{ invoiceLineId: ids.inv1Line, quantity: 1 }] }), /different customer/);
    await assert.rejects(notes.createCreditDebitNote({ firmId: ids.firm, branchId: ids.branch, noteType: "CREDIT", noteDate: new Date("2026-08-01"), customerId: ids.c1, originalInvoiceId: ids.inv1, reason: "OTHERS", lines: [{ invoiceLineId: ids.inv1Line, quantity: 1 }] }), /before its invoice/);
  });

  it("a debit note without an invoice needs a place of supply and ex-tax price, and uses its own series", async () => {
    await assert.rejects(notes.createCreditDebitNote({ firmId: ids.firm, branchId: ids.branch, noteType: "DEBIT", customerId: ids.c1, reason: "OTHERS", lines: [{ description: "Freight", quantity: 1, unitPrice: 500, gstRate: 18 }] }), /Place of supply is required/);
    const dn = await notes.createCreditDebitNote({ firmId: ids.firm, branchId: ids.branch, noteType: "DEBIT", noteDate: new Date("2026-09-20T10:00:00+05:30"), customerId: ids.c1, placeOfSupplyCode: "29", originalInvoiceNumber: "OLD-7", originalInvoiceDate: new Date("2026-08-01"), reason: "OTHERS", lines: [{ description: "Freight", hsnCode: "996511", quantity: 1, unitPrice: 500, gstRate: 18, uqc: "NOS" }], userId: ids.user });
    assert.match(dn.noteNumber, /^DN\/26-27\/1$/);
    assert.deepEqual([Number(dn.taxableAmount), Number(dn.cgstAmount), Number(dn.totalAmount)], [500, 45, 590]);
  });

  it("the GSTR-1 shows the notes in cdnr, nets them off, and still reconciles to the register and the ledger", async () => {
    const r = await buildReport();
    assert.deepEqual(r.reconciliation.filter((x) => x.ok === false).map((x) => [x.key, x.reported, x.expected]), []);
    assert.equal(r.cdnr.length, 2);
    assert.deepEqual(r.cdnr.map((x) => [x.noteType, x.number, x.taxable, x.originalNumber]), [["C", "CN/26-27/1", 200, "101"], ["D", "DN/26-27/1", 500, "OLD-7"]]);
    assert.equal(r.totals.net.taxable, 1000 + 500 + 300 - 200 + 500);
    assert.deepEqual(r.docs.map((d) => [d.nature, d.from, d.to, d.total]), [["Invoices for outward supply", "101", "103", 3], ["Credit Note", "CN/26-27/1", "CN/26-27/1", 1], ["Debit Note", "DN/26-27/1", "DN/26-27/1", 1]]);
    assert.equal(codes(r, "NOTE_INVOICE_NOT_IN_ERP").length, 1, "the debit note refers to an invoice outside the ERP");
    assert.equal(r.hsnB2b.find((x) => x.hsn === "85071000")!.quantity, 8);
  });

  it("cancelling a note removes it from the return, counts it in table 13, and reverses the ledger", async () => {
    await notes.cancelCreditDebitNote({ firmId: ids.firm, noteId, reason: "Issued in error", userId: ids.user });
    const r = await buildReport();
    assert.equal(r.cdnr.filter((x) => x.noteType === "C").length, 0);
    const cn = r.docs.find((d) => d.nature === "Credit Note")!;
    assert.deepEqual([cn.total, cn.cancelled], [1, 1]);
    assert.deepEqual(r.reconciliation.filter((x) => x.ok === false).map((x) => x.key), []);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: ids.c1 } });
    assert.equal(Number(customer.outstandingAmount), 1180 + 590, "invoice + debit note, credit note reversed");
    await assert.rejects(notes.cancelCreditDebitNote({ firmId: ids.firm, noteId, reason: "again" }), /already cancelled/);
  });

  it("only an approved sales return can generate a credit note, and only once", async () => {
    const ret = await prisma.salesReturn.create({ data: { firmId: ids.firm, branchId: ids.branch, returnNumber: "SR-1", invoiceId: ids.inv3, customerId: ids.c2, status: "PENDING", taxMode: "GST", reason: "Faulty", totalAmount: 118, lines: { create: [{ productId: ids.product, description: "Battery", quantity: 1, unitPrice: 100, gstRate: 18, lineTotal: 118, invoiceLineId: (await prisma.invoiceLine.findFirstOrThrow({ where: { invoiceId: ids.inv3 } })).id }] } } });
    await assert.rejects(notes.createCreditNoteFromSalesReturn({ firmId: ids.firm, branchId: ids.branch, salesReturnId: ret.id }), /approved/);
    await prisma.salesReturn.update({ where: { id: ret.id }, data: { status: "APPROVED" } });
    const note = await notes.createCreditNoteFromSalesReturn({ firmId: ids.firm, branchId: ids.branch, salesReturnId: ret.id, userId: ids.user });
    assert.equal(Number(note.totalAmount), 118);
    assert.equal(note.reason, "SALES_RETURN");
    await assert.rejects(notes.createCreditNoteFromSalesReturn({ firmId: ids.firm, branchId: ids.branch, salesReturnId: ret.id }), /already has a credit note/);
    assert.equal(await prisma.creditDebitNote.count({ where: { salesReturnId: { not: null } } }), 1);
  });

  it("is scoped to the firm and never edits another firm's documents", async () => {
    await assert.rejects(fixes.updateInvoiceGstDetails({ firmId: "someone-else", userId: ids.user }, ids.inv1, { reverseCharge: true }), /not found/);
  });
});
