#!/usr/bin/env tsx
/**
 * CLI Command: Historical Invoice CSV Seeder
 *
 * Usage:
 *   # 1. Dry run (default safe mode, zero database changes):
 *   npm run seed:historical
 *   # or explicitly:
 *   npx tsx scripts/seed-historical-invoices.ts --dry-run
 *
 *   # 2. Sample test verification (creates sample invoice, verifies DB & renders PDF):
 *   npx tsx scripts/seed-historical-invoices.ts --sample
 *
 *   # 3. Production import of validated records (requires explicit --confirm):
 *   npx tsx scripts/seed-historical-invoices.ts --import --confirm
 */

import fs from "node:fs";
import path from "node:path";

// Ensure .env is loaded so Prisma connects to the intended Postgres database rather than PGlite fallback
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

import { HistoricalImporter } from "../src/lib/historical-seeder/historical-importer";
import type { SeederOptions } from "../src/lib/historical-seeder/types";

function parseArgs(): SeederOptions {
  const args = process.argv.slice(2);
  const options: SeederOptions = {
    dataDir: path.join(process.cwd(), "data", "historical-csv"),
    dryRun: true,
    confirm: false,
    firmId: "firm_technic_main",
    branchId: "",
    sampleTest: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--import") {
      options.dryRun = false;
    } else if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--all") {
      options.resolveInvoiceNumbers = true;
      options.autoCatalogProducts = true;
      options.fallbackEmptyItems = true;
      options.forceReview = true;
    } else if (arg === "--resolve-numbers") {
      options.resolveInvoiceNumbers = true;
    } else if (arg === "--auto-catalog") {
      options.autoCatalogProducts = true;
    } else if (arg === "--fallback-empty-items") {
      options.fallbackEmptyItems = true;
    } else if (arg === "--force-review") {
      options.forceReview = true;
    } else if (arg === "--sample" || arg === "--sample-test") {
      options.sampleTest = true;
    } else if (arg === "--data-dir" && i + 1 < args.length) {
      options.dataDir = path.resolve(args[++i]);
    } else if (arg === "--firm-id" && i + 1 < args.length) {
      options.firmId = args[++i];
    } else if (arg === "--branch-id" && i + 1 < args.length) {
      options.branchId = args[++i];
    } else if (arg === "--report" && i + 1 < args.length) {
      options.reportOut = path.resolve(args[++i]);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  const importer = new HistoricalImporter(options);
  const summary = await importer.execute();

  console.log("------------------------------------------------------");
  console.log(`EXECUTION SUMMARY:`);
  console.log(`  Mode:                           ${summary.mode}`);
  console.log(`  Total Invoices in CSV:          ${summary.totalInvoicesInCsv}`);
  console.log(`  Flagged for Review:             ${summary.invoicesFlaggedForReview}`);
  console.log(`  Missing Invoice Number:         ${summary.invoicesMissingNumber}`);
  console.log(`  Math / Total Discrepancies:     ${summary.invoicesWithDiscrepancies}`);
  console.log(`  Qualified for Import:           ${summary.invoicesValidForImport}`);
  console.log(`  Invoices Actually Imported:     ${summary.invoicesActuallyImported}`);
  console.log(`  Invoices Skipped (Duplicate):   ${summary.invoicesSkippedAsDuplicate}`);
  console.log(`  Invoices Rejected / Staged:     ${summary.invoicesRejected}`);
  console.log(`  Line Items Evaluated:           ${summary.totalLineItemsProcessed}`);
  console.log(`  Line Items Imported:            ${summary.lineItemsImported}`);
  console.log(`  Unresolved Product Items:       ${summary.lineItemsUnresolvedProduct}`);
  console.log(`  Customers Processed:            ${summary.totalCustomersProcessed}`);
  console.log(`  Customers Matched:              ${summary.customersMatched}`);
  console.log(`  Customers Created:              ${summary.customersCreated}`);
  console.log(`  Customers Failed:               ${summary.customersFailed}`);

  if (summary.sampleTestResult) {
    console.log(`\nSAMPLE TEST RESULT:`);
    console.log(`  Success:                        ${summary.sampleTestResult.success ? "YES" : "NO"}`);
    console.log(`  Sample Invoice Number:          ${summary.sampleTestResult.sampleInvoiceNumber}`);
    console.log(`  PDF Generated:                  ${summary.sampleTestResult.pdfGenerated ? "YES" : "NO"} (${summary.sampleTestResult.pdfSizeBytes} bytes)`);
  }
  console.log("------------------------------------------------------\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL: Historical seeder execution failed:", err);
  process.exit(1);
});
