#!/usr/bin/env tsx
/**
 * CLI Command: Rollback Historical Seeded Data
 *
 * Removes all imported historical invoices, historical line items, and
 * auto-cataloged historical products created by the seeder, restoring
 * the database to its pre-seeded state.
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

async function withRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 1500): Promise<T> {
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
  console.log("TECHNIC TECHNOLOGY ERP — HISTORICAL DATA ROLLBACK");
  console.log("======================================================\n");

  // 1. Find historical invoices
  const historicalInvoices = await withRetry(() =>
    prisma.invoice.findMany({
    where: {
      OR: [
        { notes: { startsWith: "Historical invoice imported from" } },
        { notes: { contains: ".pdf" } },
        { invoiceNumber: { startsWith: "HIST/" } },
        { notes: { contains: "Sample historical test" } },
      ],
    },
    select: { id: true, invoiceNumber: true },
  }));

  const invoiceIds = historicalInvoices.map((i) => i.id);
  console.log(`Found ${invoiceIds.length} historical invoices to delete.`);

  // 2. Delete invoice lines and invoices
  if (invoiceIds.length > 0) {
    const deletedLines = await withRetry(() =>
      prisma.invoiceLine.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      })
    );
    console.log(`  • Deleted ${deletedLines.count} invoice line items.`);

    const deletedInvoices = await withRetry(() =>
      prisma.invoice.deleteMany({
        where: { id: { in: invoiceIds } },
      })
    );
    console.log(`  • Deleted ${deletedInvoices.count} historical invoices.`);

    const deletedSeqs = await withRetry(() =>
      prisma.documentSequence.deleteMany({
        where: { documentType: "invoice" },
      })
    );
    console.log(`  • Reset ${deletedSeqs.count} invoice sequence records.`);
  }

  // 3. Find and delete auto-cataloged historical products
  const historicalProducts = await withRetry(() =>
    prisma.product.findMany({
      where: {
        OR: [
          { sku: { startsWith: "HIST-" } },
          { description: "Imported from historical invoice catalog" },
        ],
      },
      select: { id: true, sku: true },
    })
  );

  const productIds = historicalProducts.map((p) => p.id);
  console.log(`\nFound ${productIds.length} historical auto-cataloged products to delete.`);

  if (productIds.length > 0) {
    // Check if any product has remaining invoice lines before deletion
    const remainingLines = await withRetry(() =>
      prisma.invoiceLine.count({
        where: { productId: { in: productIds } },
      })
    );
    if (remainingLines > 0) {
      console.warn(`  ⚠ Warning: ${remainingLines} invoice lines still reference these products. Product deletion skipped.`);
    } else {
      const deletedProducts = await withRetry(() =>
        prisma.product.deleteMany({
          where: { id: { in: productIds } },
        })
      );
      console.log(`  • Deleted ${deletedProducts.count} auto-cataloged products.`);
    }
  }

  // 4. Verification of final counts
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
