#!/usr/bin/env tsx
/**
 * CLI Command: Rollback Historical Seeded Data
 *
 * Removes all imported historical invoices, historical line items,
 * associated stock transactions, auto-cataloged historical products,
 * historical customers created during seeding, and resets sequences.
 */

import fs from "node:fs";
import path from "node:path";

// Ensure .env is loaded
if (typeof (process as any).loadEnvFile === "function") {
  try {
    (process as any).loadEnvFile(".env");
  } catch {}
} else if (fs.existsSync(".env")) {
  const content = fs.readFileSync(".env", "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

import { prisma } from "../src/lib/prisma";

async function withRetry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 2000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (i < attempts - 1) {
        console.warn(`Database connection retry (${i + 1}/${attempts}): ${err?.message || err}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

async function rollback() {
  console.log("\n======================================================");
  console.log("TECHNIC TECHNOLOGY ERP — FULL HISTORICAL DATA ROLLBACK");
  console.log("======================================================\n");

  // 1. Identify historical invoices
  const historicalInvoices = await withRetry(() =>
    prisma.invoice.findMany({
      where: {
        OR: [
          { notes: { startsWith: "Historical invoice imported from" } },
          { notes: { contains: ".pdf" } },
          { invoiceNumber: { startsWith: "HIST/" } },
          { notes: { contains: "Sample historical test" } },
          { notes: { contains: "historical" } },
        ],
      },
      select: { id: true, invoiceNumber: true },
    })
  );

  const invoiceIds = historicalInvoices.map((i) => i.id);
  const invoiceNumbers = historicalInvoices.map((i) => i.invoiceNumber);
  console.log(`Found ${invoiceIds.length} historical invoices to delete.`);

  // 2. Identify auto-cataloged historical products
  const historicalProducts = await withRetry(() =>
    prisma.product.findMany({
      where: {
        OR: [
          { sku: { startsWith: "HIST-" } },
          { description: { contains: "historical" } },
          { description: { contains: "Historical" } },
        ],
      },
      select: { id: true, sku: true },
    })
  );
  const productIds = historicalProducts.map((p) => p.id);
  console.log(`Found ${productIds.length} historical auto-cataloged products.`);

  // 3. Clean up associated stock transactions
  const deletedStockTxns = await withRetry(() =>
    prisma.stockTransaction.deleteMany({
      where: {
        OR: [
          ...(invoiceIds.length > 0 ? [{ documentId: { in: invoiceIds } }] : []),
          ...(invoiceNumbers.length > 0 ? [{ reference: { in: invoiceNumbers } }] : []),
          ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
        ],
      },
    })
  );
  console.log(`  • Deleted ${deletedStockTxns.count} associated stock transaction entries.`);

  // 4. Delete invoice line items
  if (invoiceIds.length > 0) {
    const deletedLines = await withRetry(() =>
      prisma.invoiceLine.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      })
    );
    console.log(`  • Deleted ${deletedLines.count} invoice line items.`);

    // 5. Delete invoices
    const deletedInvoices = await withRetry(() =>
      prisma.invoice.deleteMany({
        where: { id: { in: invoiceIds } },
      })
    );
    console.log(`  • Deleted ${deletedInvoices.count} historical invoices.`);
  }

  // 6. Delete auto-cataloged products (now safe since lines & stock txns are cleared)
  if (productIds.length > 0) {
    const deletedProducts = await withRetry(() =>
      prisma.product.deleteMany({
        where: { id: { in: productIds } },
      })
    );
    console.log(`  • Deleted ${deletedProducts.count} auto-cataloged historical products.`);
  }

  // 7. Find and delete historical customers (created by historical seeder)
  const historicalCustomers = await withRetry(() =>
    prisma.customer.findMany({
      where: {
        OR: [
          { notes: { contains: "historical" } },
          { notes: { contains: "Historical" } },
        ],
      },
      select: { id: true, code: true, name: true },
    })
  );

  const customerIds = historicalCustomers.map((c) => c.id);
  console.log(`\nFound ${customerIds.length} historical customers.`);

  if (customerIds.length > 0) {
    // Verify no remaining invoices, quotations, or sales orders link to these customers
    const linkedInvoices = await withRetry(() =>
      prisma.invoice.count({ where: { customerId: { in: customerIds } } })
    );
    const linkedQuotations = await withRetry(() =>
      prisma.quotation.count({ where: { customerId: { in: customerIds } } })
    );
    const linkedOrders = await withRetry(() =>
      prisma.salesOrder.count({ where: { customerId: { in: customerIds } } })
    );

    if (linkedInvoices > 0 || linkedQuotations > 0 || linkedOrders > 0) {
      console.warn(
        `  ⚠ Warning: Some historical customers still referenced (Invoices: ${linkedInvoices}, Quotes: ${linkedQuotations}, Orders: ${linkedOrders}). Deletion skipped for safety.`
      );
    } else {
      const deletedCustomers = await withRetry(() =>
        prisma.customer.deleteMany({
          where: { id: { in: customerIds } },
        })
      );
      console.log(`  • Deleted ${deletedCustomers.count} historical customer records.`);
    }
  }

  // 8. Reset document sequence counters
  const deletedInvoiceSeqs = await withRetry(() =>
    prisma.documentSequence.deleteMany({
      where: { documentType: "invoice" },
    })
  );
  console.log(`  • Reset ${deletedInvoiceSeqs.count} invoice sequence records.`);

  // Reset customer sequence to number of remaining real customers (or 1)
  const remainingCustCount = await withRetry(() => prisma.customer.count());
  const resetCustomerSeq = await withRetry(() =>
    prisma.documentSequence.updateMany({
      where: { documentType: "customer" },
      data: { value: Math.max(1, remainingCustCount) },
    })
  );
  console.log(`  • Updated ${resetCustomerSeq.count} customer sequence records (floor set to ${Math.max(1, remainingCustCount)}).`);

  // 9. Verification of final counts
  const remainingInvoices = await withRetry(() => prisma.invoice.count());
  const remainingProducts = await withRetry(() => prisma.product.count());
  const remainingCustomers = await withRetry(() => prisma.customer.count());

  console.log("\n------------------------------------------------------");
  console.log("ROLLBACK COMPLETE:");
  console.log(`  Remaining Invoices:  ${remainingInvoices}`);
  console.log(`  Remaining Products:  ${remainingProducts}`);
  console.log(`  Remaining Customers: ${remainingCustomers}`);
  console.log("------------------------------------------------------\n");

  await prisma.$disconnect();
}

rollback().catch((err) => {
  console.error("Rollback failed:", err);
  process.exit(1);
});
