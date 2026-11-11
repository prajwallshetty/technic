/**
 * Creates clearly marked TEST customers and quotations to exercise quotation
 * creation, editing, totals and PDF output end to end. No invoices.
 *
 *   npm run test-data:quotations              (create + verify)
 *   npm run test-data:quotations -- --remove  (delete everything this made)
 *
 * Test records are identifiable by: customer code TEST-CUST-n, quotation
 * number TEST-QT-n, and "TEST DATA" in their notes. Their numbers do not come
 * from the real counters (the counters are restored after creation), so real
 * document numbering is unaffected.
 *
 * Expected figures are computed here with plain arithmetic, independent of the
 * ERP's tax code, then compared with the saved quotation and with the text of
 * the generated PDF.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { prisma } from "../src/lib/prisma";
import { createCustomer } from "../src/lib/services/partners";
import { createQuotation, updateQuotation } from "../src/lib/services/sales";
import { generateQuotationPDF } from "../src/lib/pdf/pdf-templates";
import { financialYearFor } from "../src/lib/sequence";

const FIRM_ID = process.env.TEST_FIRM_ID ?? "firm_technic_main";
const OUT_DIR = process.env.TEST_OUT_DIR ?? path.join(process.cwd(), "reports", "test-quotations");
const MARK = "TEST DATA — safe to delete";
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Spec {
  name: string;
  gross: number;
  unit: number;
  qty: number;
  disc: number; // % per line
  gst: number;
}

/** Independent expectation for GST-inclusive catalogue pricing. */
function expected(lines: Spec[], interState: boolean, billDiscountPct = 0) {
  let subtotal = 0, discount = 0, taxable = 0, tax = 0;
  const per = lines.map((l) => {
    const gross = r2(l.qty * l.unit);
    const lineDisc = r2((gross * l.disc) / 100);
    const billDisc = r2(((gross - lineDisc) * billDiscountPct) / 100);
    const net = r2(gross - lineDisc - billDisc);
    const tv = l.gst > 0 ? r2(net / (1 + l.gst / 100)) : net;
    const t = r2(tv * (l.gst / 100));
    subtotal += gross; discount += lineDisc + billDisc; taxable += tv; tax += t;
    return { gross, net, tv, t };
  });
  const before = taxable + tax;
  return { per, subtotal: r2(subtotal), discount: r2(discount), taxable: r2(taxable), tax: r2(tax), interState, total: Math.round(before), before: r2(before) };
}

const inr = (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

async function remove() {
  const quotes = await prisma.quotation.findMany({ where: { firmId: FIRM_ID, quotationNumber: { startsWith: "TEST-QT-" } }, select: { id: true } });
  const customers = await prisma.customer.findMany({ where: { firmId: FIRM_ID, code: { startsWith: "TEST-CUST-" } }, select: { id: true } });
  await prisma.quotation.deleteMany({ where: { id: { in: quotes.map((q) => q.id) } } }); // lines cascade
  await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entity: "Quotation", entityId: { in: quotes.map((q) => q.id) } }, { entity: "Customer", entityId: { in: customers.map((c) => c.id) } }] } });
  console.log(`Removed ${quotes.length} test quotations and ${customers.length} test customers.`);
}

async function main() {
  if (process.argv.includes("--remove")) return remove();
  if ((await prisma.customer.count({ where: { firmId: FIRM_ID, code: { startsWith: "TEST-CUST-" } } })) > 0) {
    throw new Error("Test data already exists — run with --remove first");
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const user = await prisma.user.findFirstOrThrow({ where: { firmId: FIRM_ID }, orderBy: { createdAt: "asc" } });
  const branch = await prisma.branch.findFirstOrThrow({ where: { firmId: FIRM_ID, isActive: true }, orderBy: { createdAt: "asc" } });
  const fy = financialYearFor();
  const seqBefore = await prisma.documentSequence.findMany({ where: { firmId: FIRM_ID, documentType: { in: ["quotation", "customer"] } } });
  const quotationSeq = seqBefore.find((s) => s.documentType === "quotation" && s.financialYear === fy && s.taxMode === "NON_GST");
  const customerSeq = seqBefore.find((s) => s.documentType === "customer");

  const byName = async (name: string) => prisma.product.findFirstOrThrow({ where: { firmId: FIRM_ID, name, status: "ACTIVE", trackSerials: false } });
  const zeroRated = await prisma.product.findFirstOrThrow({ where: { firmId: FIRM_ID, gstRate: 0, status: "ACTIVE", trackSerials: false } });
  const P = {
    pump1: await byName("1.0HP OPENWELL SUBMERCIBLE HAVY"),
    solar: await byName("CD Solar panels Copper"),
    sewage: await byName("2HP SEWAGE PUMP WITH CUTTER"),
    inverter: await byName("AMARON INVERTOR 1200"),
    q150: await byName("AMARON QUANTA 150AH TUBLER BATTERY"),
    kva3: await byName("3KVA ALPHA ONLINE INVERTOR IGBT INCLUDING INS"),
    q200: await byName("AMARON QUANTA 200AH TUBLER BATTERY"),
    zero: zeroRated,
  };
  const spec = (p: (typeof P)[keyof typeof P], qty: number, disc: number): Spec => ({ name: p.name, gross: 0, unit: Number(p.sellingPrice), qty, disc, gst: Number(p.gstRate) });
  const line = (p: (typeof P)[keyof typeof P], qty: number, disc: number) => ({ productId: p.id, quantity: qty, unitPrice: Number(p.sellingPrice), discountPercent: disc, gstRate: Number(p.gstRate) });

  // ---- customers ------------------------------------------------------------
  const common = { firmId: FIRM_ID, branchId: branch.id, userId: user.id, notes: MARK };
  const customers = [
    await createCustomer({ ...common, name: "TEST CUSTOMER 1 — registered, Karnataka (delete me)", phone: "9000000001", gstin: "29ABCDE1234F1Z5", state: "Karnataka", stateCode: "29", addressLine: "TEST address, Mangaluru", type: "BUSINESS" }),
    await createCustomer({ ...common, name: "TEST CUSTOMER 2 — retail, unregistered (delete me)", phone: "9000000002", state: "Karnataka", stateCode: "29", addressLine: "TEST address, Udupi", type: "RETAIL" }),
    await createCustomer({ ...common, name: "TEST CUSTOMER 3 — Tamil Nadu, inter-state (delete me)", phone: "9000000003", gstin: "33ABCDE1234F1Z5", state: "Tamil Nadu", stateCode: "33", addressLine: "TEST address, Coimbatore", type: "BUSINESS" }),
  ];
  for (const [i, c] of customers.entries()) await prisma.customer.update({ where: { id: c.id }, data: { code: `TEST-CUST-${i + 1}` } });

  // ---- quotations --------------------------------------------------------------
  const plans = [
    { customer: customers[0], inter: false, billDisc: 0, specs: [spec(P.pump1, 2, 5), spec(P.solar, 3, 0), spec(P.zero, 1, 0)], lines: [line(P.pump1, 2, 5), line(P.solar, 3, 0), line(P.zero, 1, 0)], note: "per-line discount, 18% + 5% + 0% rates" },
    { customer: customers[1], inter: false, billDisc: 10, specs: [spec(P.sewage, 1, 0), spec(P.inverter, 4, 0), spec(P.q150, 2, 0)], lines: [line(P.sewage, 1, 0), line(P.inverter, 4, 0), line(P.q150, 2, 0)], note: "10% bill-level discount" },
    { customer: customers[2], inter: true, billDisc: 0, specs: [spec(P.kva3, 1, 2.5), spec(P.q200, 5, 12), spec(P.solar, 2, 5)], lines: [line(P.kva3, 1, 2.5), line(P.q200, 5, 12), line(P.solar, 2, 5)], note: "inter-state IGST, 18% + 5%" },
  ];

  const created: { id: string; plan: (typeof plans)[number] }[] = [];
  for (const [i, plan] of plans.entries()) {
    const q = await createQuotation({
      firmId: FIRM_ID, branchId: branch.id, customerId: plan.customer.id, taxMode: "GST", userId: user.id,
      notes: `${MARK}. ${plan.note}.`, terms: "TEST DATA", lines: plan.lines,
      billDiscount: plan.billDisc ? { type: "%", value: plan.billDisc } : null,
    });
    await prisma.quotation.update({ where: { id: q.id }, data: { quotationNumber: `TEST-QT-${i + 1}` } });
    created.push({ id: q.id, plan });
  }
  // Restore the real counters so the test records did not consume real numbers.
  if (quotationSeq) await prisma.documentSequence.update({ where: { id: quotationSeq.id }, data: { value: quotationSeq.value } });
  if (customerSeq) await prisma.documentSequence.update({ where: { id: customerSeq.id }, data: { value: customerSeq.value } });

  // ---- verify: saved values vs independent arithmetic vs PDF text ------------
  const results: string[] = [];
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string) => { results.push(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : "  — " + detail}`); if (!ok) failures++; };

  async function verify(id: string, plan: (typeof plans)[number], tag: string) {
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id }, include: { lines: true, customer: true } });
    const exp = expected(plan.specs, plan.inter, plan.billDisc);
    const tol = 0.05 * plan.specs.length;
    const near = (a: number, b: number, t = tol) => Math.abs(a - b) <= t;
    const n = (v: unknown) => Number(v);
    check(`${tag} number`, q.quotationNumber.startsWith("TEST-QT-"), q.quotationNumber);
    check(`${tag} subtotal`, near(n(q.subtotal), exp.subtotal, 0.01), `${n(q.subtotal)} vs ${exp.subtotal}`);
    check(`${tag} discount`, near(n(q.discountAmount), exp.discount), `${n(q.discountAmount)} vs ${exp.discount}`);
    check(`${tag} taxable value`, near(n(q.taxableAmount), exp.taxable), `${n(q.taxableAmount)} vs ${exp.taxable}`);
    const tax = n(q.cgstAmount) + n(q.sgstAmount) + n(q.igstAmount);
    check(`${tag} total GST`, near(tax, exp.tax), `${tax} vs ${exp.tax}`);
    check(`${tag} ${plan.inter ? "IGST only" : "CGST = SGST, no IGST"}`, plan.inter ? n(q.cgstAmount) === 0 && n(q.sgstAmount) === 0 && n(q.igstAmount) > 0 : n(q.igstAmount) === 0 && near(n(q.cgstAmount), n(q.sgstAmount), 0.02), `c=${n(q.cgstAmount)} s=${n(q.sgstAmount)} i=${n(q.igstAmount)}`);
    check(`${tag} grand total`, near(n(q.totalAmount), exp.total, 1), `${n(q.totalAmount)} vs ${exp.total}`);
    check(`${tag} total = taxable + GST + round-off`, near(n(q.taxableAmount) + tax + n(q.roundOff), n(q.totalAmount), 0.02), `${n(q.taxableAmount)}+${tax}+${n(q.roundOff)} vs ${n(q.totalAmount)}`);

    const { buffer } = await generateQuotationPDF(id);
    const pdfPath = path.join(OUT_DIR, `${q.quotationNumber}-${tag}.pdf`);
    fs.writeFileSync(pdfPath, buffer);
    const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
    check(`${tag} PDF is a PDF`, buffer.subarray(0, 5).toString() === "%PDF-", "bad header");
    check(`${tag} PDF shows quotation number`, text.includes(q.quotationNumber), "missing");
    check(`${tag} PDF shows customer`, text.includes("TEST CUSTOMER"), "missing");
    check(`${tag} PDF shows grand total ${inr(n(q.totalAmount))}`, text.includes(inr(n(q.totalAmount))), "missing");
    check(`${tag} PDF shows taxable ${inr(n(q.taxableAmount))}`, text.includes(inr(n(q.taxableAmount))), "missing");
    for (const field of [["CGST", q.cgstAmount], ["SGST", q.sgstAmount], ["IGST", q.igstAmount]] as const) {
      if (n(field[1]) > 0) check(`${tag} PDF shows ${field[0]} ${inr(n(field[1]))}`, text.includes(inr(n(field[1]))), "missing");
    }
    for (const l of q.lines) {
      check(`${tag} PDF line "${l.description.slice(0, 28)}" qty ${l.quantity}`, text.includes(l.description.slice(0, 18)), "description missing");
    }
    return q;
  }

  for (const [i, c] of created.entries()) await verify(c.id, c.plan, `Q${i + 1}`);

  // ---- edit Q1: quantity, discount, notes — then re-verify ----------------------
  const first = created[0];
  const editedSpecs = [spec(P.pump1, 3, 7.5), first.plan.specs[1], first.plan.specs[2]];
  const editedLines = [line(P.pump1, 3, 7.5), first.plan.lines[1], first.plan.lines[2]];
  const before = await prisma.quotation.findUniqueOrThrow({ where: { id: first.id } });
  await updateQuotation({
    firmId: FIRM_ID, quotationId: first.id, userId: user.id, lines: editedLines, billDiscount: null,
    notes: `${MARK}. EDITED: qty 2→3, discount 5%→7.5%.`,
  });
  const after = await prisma.quotation.findUniqueOrThrow({ where: { id: first.id } });
  check("Q1 edit: number unchanged", after.quotationNumber === before.quotationNumber, `${before.quotationNumber} → ${after.quotationNumber}`);
  check("Q1 edit: total changed", Number(after.totalAmount) !== Number(before.totalAmount), "unchanged");
  await verify(first.id, { ...first.plan, specs: editedSpecs }, "Q1-edited");

  fs.writeFileSync(path.join(OUT_DIR, "verification.txt"), results.join("\n") + "\n");
  console.log(results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} checks passed; PDFs in ${OUT_DIR}`);
  console.log(`Created: ${customers.length} test customers (TEST-CUST-1..3), ${created.length} test quotations (TEST-QT-1..3). Invoices created: 0.`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
