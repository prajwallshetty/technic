/**
 * Posts reviewed SALES documents from the invoice-import queue into the ERP
 * as historical invoices.
 *
 *   npm run invoice-import:post-sales -- [--firm <id>] [--branch <id>] [--exclude "147 ms bat.pdf"] [--confirm]
 *
 * Without --confirm it is a dry run that prints the plan and writes nothing.
 *
 * What it writes, per invoice, in one transaction:
 *   - the customer (matched by GSTIN or name, else created exactly as printed;
 *     no phone is invented when none is printed),
 *   - any missing products (one per distinct item description, plus two
 *     non-stock products for discount and transport lines),
 *   - the Invoice + lines with the PRINTED figures (status ISSUED, full amount
 *     outstanding), and marks the import document POSTED.
 * It never writes stock transactions, serial movements or payments, and skips
 * any invoice number already present, so it is safe to re-run.
 *
 * Only documents whose printed grand total equals the independently
 * recalculated total, and whose only open errors are product matches (or a
 * duplicate number whose twin is excluded), are posted.
 */
import { prisma } from "../src/lib/prisma";
import { recordAudit } from "../src/lib/audit";
import { financialYearFor, nextCustomerCode } from "../src/lib/sequence";
import { recalcCustomerRollup } from "../src/lib/services/sales";
import type { DraftInvoice, DraftLine } from "../src/lib/invoice-import/draft";
import type { Evaluation } from "../src/lib/invoice-import/pipeline";
import { ProductMatcher, type CatalogueProduct } from "../src/lib/invoice-import/matching";
import { compactKey, gstinStateCode, round2 } from "../src/lib/invoice-import/normalize";

const argv = process.argv.slice(2);
const arg = (name: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const confirm = argv.includes("--confirm");
const excluded = new Set(argv.flatMap((a, i) => (argv[i - 1] === "--exclude" ? [a] : [])));

const STATE_BY_CODE: Record<string, string> = { "29": "Karnataka", "33": "Tamil Nadu", "32": "Kerala", "27": "Maharashtra", "36": "Telangana", "37": "Andhra Pradesh", "30": "Goa" };
const ALLOWED_OPEN_ERRORS = new Set(["PRODUCT_NOT_FOUND", "PRODUCT_NEEDS_CONFIRMATION", "PRODUCT_AMBIGUOUS"]);

async function main() {
  const firm = arg("firm")
    ? await prisma.firm.findUniqueOrThrow({ where: { id: arg("firm")! } })
    : await prisma.firm.findFirstOrThrow({ where: { deletedAt: null, gstin: { not: null } }, orderBy: { createdAt: "asc" } });
  const branch = arg("branch")
    ? await prisma.branch.findFirstOrThrow({ where: { id: arg("branch")!, firmId: firm.id } })
    : await prisma.branch.findFirstOrThrow({ where: { firmId: firm.id, isActive: true }, orderBy: { createdAt: "asc" } });
  console.log(`Firm ${firm.name} (${firm.gstin}) · branch ${branch.name} · ${confirm ? "WRITING" : "DRY RUN"}`);

  const docs = await prisma.invoiceImportDocument.findMany({
    where: { firmId: firm.id, direction: "SALES", status: { in: ["READY", "NEEDS_REVIEW", "DUPLICATE"] } },
    select: { id: true, sourceFilename: true, draft: true, evaluation: true },
  });
  docs.sort((a, b) => a.sourceFilename.localeCompare(b.sourceFilename, undefined, { numeric: true }));

  // ---- Decide what is postable --------------------------------------------
  const existingNumbers = new Set((await prisma.invoice.findMany({ select: { invoiceNumber: true } })).map((i) => i.invoiceNumber));
  const excludedDocIds = new Set(docs.filter((d) => excluded.has(d.sourceFilename)).map((d) => d.id));
  const plan: Array<{ id: string; file: string; draft: DraftInvoice }> = [];
  const skipped: string[] = [];
  for (const doc of docs) {
    const draft = doc.draft as unknown as DraftInvoice;
    const ev = doc.evaluation as unknown as Evaluation;
    if (excluded.has(doc.sourceFilename)) { skipped.push(`${doc.sourceFilename}: excluded`); continue; }
    if (!draft?.invoiceNumber || !draft.invoiceDate || draft.totals.grandTotal === null) { skipped.push(`${doc.sourceFilename}: missing number/date/total`); continue; }
    if (existingNumbers.has(draft.invoiceNumber)) { skipped.push(`${doc.sourceFilename}: invoice ${draft.invoiceNumber} already in the ERP`); continue; }
    if (ev?.reconciliation.grandTotalDifference !== 0) { skipped.push(`${doc.sourceFilename}: grand total not reconciled`); continue; }
    const blocking = ev.issues.filter((i) => {
      if (i.severity !== "ERROR" || i.details?.acknowledged || ALLOWED_OPEN_ERRORS.has(i.code)) return false;
      if (i.code === "DUPLICATE_INVOICE_NUMBER" && excludedDocIds.has(String(i.details?.otherDocumentId))) return false;
      return true;
    });
    if (blocking.length) { skipped.push(`${doc.sourceFilename}: ${blocking.map((i) => i.code).join(", ")}`); continue; }
    if (plan.some((p) => p.draft.invoiceNumber === draft.invoiceNumber)) { skipped.push(`${doc.sourceFilename}: number ${draft.invoiceNumber} repeated in this run`); continue; }
    plan.push({ id: doc.id, file: doc.sourceFilename, draft });
  }

  // ---- Products ------------------------------------------------------------
  const existingProducts = await prisma.product.findMany({
    where: { firmId: firm.id },
    select: { id: true, sku: true, name: true, subName: true, barcode: true, modelNumber: true, partNumber: true, hsnCode: true, status: true },
  });
  const aliases = await prisma.invoiceImportProductAlias.findMany({ where: { firmId: firm.id } });
  const matcher = new ProductMatcher(existingProducts as CatalogueProduct[], aliases);
  const usedSkus = new Set(existingProducts.map((p) => p.sku.toUpperCase()));
  const productFor = new Map<string, { id: string | null; create?: { sku: string; name: string; hsnCode: string | null; gstRate: number; sellingPrice: number; description: string } }>();
  const keyFor = (line: DraftLine) =>
    line.kind === "ADJUSTMENT" ? (/transport|freight|courier|delivery/i.test(line.description ?? "") ? "@TRANSPORT" : "@DISCOUNT") : compactKey(line.description);
  const uniqueSku = (base: string) => {
    let sku = base.slice(0, 40);
    for (let n = 2; usedSkus.has(sku.toUpperCase()); n++) sku = `${base.slice(0, 36)}-${n}`;
    usedSkus.add(sku.toUpperCase());
    return sku;
  };
  for (const { draft } of plan) {
    for (const line of draft.lines) {
      const key = keyFor(line);
      if (productFor.has(key)) {
        const planned = productFor.get(key)!;
        if (planned.create && line.rate !== null && line.rate > 0) planned.create.sellingPrice = line.rate; // last printed rate wins
        continue;
      }
      if (key === "@DISCOUNT" || key === "@TRANSPORT") {
        const name = key === "@DISCOUNT" ? "DISCOUNT (non-stock)" : "TRANSPORT CHARGES (non-stock)";
        const found = existingProducts.find((p) => p.name === name);
        productFor.set(key, found ? { id: found.id } : { id: null, create: { sku: uniqueSku(key === "@DISCOUNT" ? "IMP-DISCOUNT" : "IMP-TRANSPORT"), name, hsnCode: null, gstRate: key === "@DISCOUNT" ? 18 : 0, sellingPrice: 0, description: "Non-stock line for invoice discounts/charges. Never stocked or received." } });
        continue;
      }
      const match = matcher.match({ kind: "ITEM", description: line.description });
      if (match.status === "MATCHED" && match.productId) productFor.set(key, { id: match.productId });
      else productFor.set(key, { id: null, create: { sku: uniqueSku(`IMP-${compactKey(line.description).slice(0, 34)}`), name: line.description!, hsnCode: line.hsn, gstRate: line.gstRate ?? 18, sellingPrice: line.rate ?? 0, description: "Created from imported historical sales invoices" } });
    }
  }

  // ---- Customers -----------------------------------------------------------
  const existingCustomers = await prisma.customer.findMany({ where: { firmId: firm.id }, select: { id: true, name: true, gstin: true } });
  const customerKey = (d: DraftInvoice) => (d.partyGstin ? `G:${d.partyGstin}` : `N:${compactKey(d.partyName)}`);
  const customerFor = new Map<string, { id: string | null; draft: DraftInvoice; file: string }>();
  for (const { draft, file } of plan) {
    const key = customerKey(draft);
    if (customerFor.has(key)) continue;
    const found = existingCustomers.find((c) => (draft.partyGstin && c.gstin?.toUpperCase() === draft.partyGstin) || compactKey(c.name) === compactKey(draft.partyName));
    customerFor.set(key, { id: found?.id ?? null, draft, file });
  }

  const newProducts = [...productFor.values()].filter((p) => p.create);
  const newCustomers = [...customerFor.values()].filter((c) => !c.id);
  const total = round2(plan.reduce((n, p) => n + (p.draft.totals.grandTotal ?? 0), 0));
  console.log(`\nInvoices to post: ${plan.length} (total ₹${total.toFixed(2)}, all outstanding)`);
  console.log(`Customers: ${customerFor.size - newCustomers.length} existing, ${newCustomers.length} to create`);
  for (const c of newCustomers) console.log(`  + ${c.draft.partyName} | GSTIN ${c.draft.partyGstin ?? "—"} | phone ${c.draft.partyPhone ?? "(none printed)"}`);
  console.log(`Products: ${productFor.size - newProducts.length} matched, ${newProducts.length} to create`);
  for (const p of newProducts) console.log(`  + ${p.create!.sku} | ${p.create!.name} | HSN ${p.create!.hsnCode ?? "—"} | GST ${p.create!.gstRate}%`);
  console.log(`Skipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  - ${s}`);
  if (!confirm) {
    console.log("\nDry run — nothing written. Re-run with --confirm to post.");
    return;
  }

  // ---- Write -----------------------------------------------------------------
  for (const p of newProducts) {
    const created = await prisma.product.create({
      data: { firmId: firm.id, sku: p.create!.sku, name: p.create!.name, hsnCode: p.create!.hsnCode, gstRate: p.create!.gstRate, sellingPrice: p.create!.sellingPrice, purchasePrice: 0, unit: "pcs", status: "ACTIVE", description: p.create!.description },
    });
    p.id = created.id;
    await recordAudit({ action: "PRODUCT_CREATED", entity: "Product", entityId: created.id, summary: `${created.name} (${created.sku}) — from imported invoices`, firmId: firm.id });
  }
  // Remember the mappings so the import queue matches these lines exactly.
  for (const [key, p] of productFor) {
    if (key.startsWith("@")) continue;
    const line = plan.flatMap((x) => x.draft.lines).find((l) => keyFor(l) === key)!;
    await prisma.invoiceImportProductAlias.upsert({
      where: { firmId_partyKey_aliasKey: { firmId: firm.id, partyKey: "", aliasKey: key } },
      create: { firmId: firm.id, partyKey: "", aliasKey: key, rawText: line.description ?? "", productId: p.id! },
      update: {},
    });
  }
  for (const c of newCustomers) {
    const d = c.draft;
    const state = STATE_BY_CODE[gstinStateCode(d.partyGstin) ?? ""] ?? null;
    const created = await prisma.customer.create({
      data: {
        firmId: firm.id, branchId: branch.id, code: await nextCustomerCode(firm.id), name: d.partyName!, phone: d.partyPhone ?? "",
        addressLine: d.partyAddress, state, stateCode: gstinStateCode(d.partyGstin), gstin: d.partyGstin, type: d.partyGstin ? "BUSINESS" : "RETAIL",
        notes: `Created from imported invoice ${c.file}.${d.partyPhone ? "" : " No phone number was printed on the invoice."}`,
      },
    });
    c.id = created.id;
    await recordAudit({ action: "CUSTOMER_CREATED", entity: "Customer", entityId: created.id, summary: `${created.name} (${created.code}) — from imported invoices`, firmId: firm.id, branchId: branch.id });
  }

  let posted = 0;
  const touchedCustomers = new Set<string>();
  for (const { id, file, draft } of plan) {
    const t = draft.totals;
    const customerId = customerFor.get(customerKey(draft))!.id!;
    const gross = t.grossAmount ?? draft.lines.reduce((n, l) => n + (l.amount ?? 0), 0);
    const discount = t.discountAmount ?? 0;
    const taxable = t.taxableAmount ?? round2(gross - discount);
    const scale = gross ? taxable / gross : 1;
    const igst = (t.igst ?? 0) > 0;
    const discountPercent = gross && discount ? round2((discount / gross) * 100) : 0;
    const date = new Date(`${draft.invoiceDate}T00:00:00+05:30`);
    try {
      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            firmId: firm.id, branchId: branch.id, customerId, invoiceNumber: draft.invoiceNumber!, kind: "TAX_INVOICE", taxMode: "GST",
            financialYear: financialYearFor(date), status: "ISSUED", invoiceDate: date,
            billToName: draft.partyName!, billToPhone: draft.partyPhone, billToAddress: draft.partyAddress, billToGstin: draft.partyGstin,
            placeOfSupply: STATE_BY_CODE[gstinStateCode(draft.partyGstin) ?? ""] ?? null,
            subtotal: gross, discountAmount: discount, discountRemarks: t.discountPercent !== null ? `${t.discountPercent}% (as printed)` : null,
            taxableAmount: taxable, cgstAmount: t.cgst ?? 0, sgstAmount: t.sgst ?? 0, igstAmount: t.igst ?? 0, roundOff: t.roundOff ?? 0,
            totalAmount: t.grandTotal!, amountPaid: 0, amountDue: t.grandTotal!,
            dispatchThrough: draft.dispatchThrough, ewayBillNumber: draft.ewayBillNumber, buyerOrderNo: draft.purchaseOrderNumber,
            notes: `Historical invoice imported from ${file} (printed invoice type: ${draft.paymentTerms ?? "—"}). Posted without stock movement.`,
            lines: {
              create: draft.lines.map((l) => {
                const amount = l.amount ?? 0;
                const qty = l.kind === "ADJUSTMENT" ? 1 : Math.round(l.quantity ?? 1);
                const rate = l.gstRate ?? 0;
                const lineTaxable = round2(amount * scale);
                const cgst = igst ? 0 : round2((lineTaxable * rate) / 200);
                const lineIgst = igst ? round2((lineTaxable * rate) / 100) : 0;
                return {
                  productId: productFor.get(keyFor(l))!.id!, description: l.description ?? "", hsnCode: l.hsn, quantity: qty,
                  unitPrice: l.kind === "ADJUSTMENT" ? amount : (l.rate ?? round2(amount / qty)), discountPercent, gstRate: rate,
                  taxableValue: lineTaxable, cgstAmount: cgst, sgstAmount: cgst, igstAmount: lineIgst, lineTotal: round2(lineTaxable + 2 * cgst + lineIgst),
                };
              }),
            },
          },
        });
        await tx.invoiceImportDocument.update({
          where: { id },
          data: { status: "POSTED", importKey: `SALES||${compactKey(draft.invoiceNumber)}`, approvedAt: new Date(), postedEntity: "Invoice", postedEntityId: invoice.id, postedAt: new Date() },
        });
        return invoice;
      }).then(async (invoice) => {
        await recordAudit({ action: "INVOICE_CREATED", entity: "Invoice", entityId: invoice.id, summary: `${invoice.invoiceNumber} (historical import from ${file})`, firmId: firm.id, branchId: branch.id, after: { total: t.grandTotal } });
        await recordAudit({ action: "INVOICE_IMPORT_POSTED", entity: "InvoiceImportDocument", entityId: id, summary: `${file}: posted as invoice ${invoice.invoiceNumber}`, firmId: firm.id });
      });
      posted++;
      touchedCustomers.add(customerId);
      if (posted % 10 === 0) console.log(`  posted ${posted}/${plan.length}`);
    } catch (error) {
      console.error(`  ! ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }

  for (const customerId of touchedCustomers) {
    await recalcCustomerRollup(prisma as never, firm.id, customerId);
    const last = await prisma.invoice.findFirst({ where: { customerId }, orderBy: { invoiceDate: "desc" }, select: { invoiceDate: true } });
    await prisma.customer.update({ where: { id: customerId }, data: { lastInvoiceAt: last?.invoiceDate ?? null } });
  }
  console.log(`\nPosted ${posted} of ${plan.length} invoices. Stock transactions written: 0. Payments written: 0.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
