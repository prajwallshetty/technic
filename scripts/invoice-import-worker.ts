/**
 * Background worker for bulk invoice imports. The web app processes uploads
 * right after the request (and whenever a batch page is open); this script
 * drains the queue for deployments where request time is short, or to retry
 * after an outage.
 *
 *   npm run invoice-import:worker -- [--firm <firmId>] [--watch]
 */
import { prisma } from "../src/lib/prisma";
import { processQueuedDocuments } from "../src/lib/services/invoice-imports";

const argv = process.argv.slice(2);
const firmArg = argv.includes("--firm") ? argv[argv.indexOf("--firm") + 1] : null;
const watch = argv.includes("--watch");

async function drainOnce(): Promise<number> {
  const firms = firmArg
    ? [{ firmId: firmArg }]
    : await prisma.invoiceImportDocument.findMany({
        where: { status: { in: ["QUEUED", "PROCESSING"] } },
        distinct: ["firmId"],
        select: { firmId: true },
      });
  let processed = 0;
  for (const { firmId } of firms) {
    for (;;) {
      const result = await processQueuedDocuments({ firmId, limit: 50, timeBudgetMs: 120_000 });
      processed += result.processed + result.failed;
      console.log(`[${firmId}] processed ${result.processed}, failed ${result.failed}, remaining ${result.remaining}`);
      if (result.remaining === 0 || result.processed + result.failed === 0) break;
    }
  }
  return processed;
}

async function main() {
  do {
    const processed = await drainOnce();
    if (!watch) break;
    if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 15_000));
  } while (watch);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
