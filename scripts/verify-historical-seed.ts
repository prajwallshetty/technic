import { prisma } from "../src/lib/prisma";

const FIRM_ID = "firm_technic_main";

async function verify() {
  console.log("================================================================================");
  console.log("HISTORICAL CSV DATABASE AUDIT VERIFICATION");
  console.log("================================================================================\n");

  const dbInvoices = await prisma.invoice.findMany({
    where: { firmId: FIRM_ID },
    include: {
      lines: {
        include: {
          product: true,
        },
      },
      customer: true,
    },
  });

  const historicalInvoices = dbInvoices.filter((i) =>
    i.notes?.includes("Historical invoice imported from"),
  );

  const totalLines = historicalInvoices.reduce((acc, inv) => acc + inv.lines.length, 0);
  const uniqueCustomersInDb = new Set(historicalInvoices.map((i) => i.customerId));
  const totalAmount = historicalInvoices.reduce((acc, inv) => acc + Number(inv.totalAmount), 0);

  console.log(`DATABASE AUDIT RESULTS:`);
  console.log(`  • Historical Invoices in DB:  ${historicalInvoices.length} / 81`);
  console.log(`  • Historical Line Items:      ${totalLines} / 262`);
  console.log(`  • Unique Customers Linked:    ${uniqueCustomersInDb.size} / 16`);
  console.log(`  • Total Invoiced Value:       ₹${totalAmount.toFixed(2)}`);

  const linesWithProducts = historicalInvoices.flatMap((i) => i.lines).filter((l) => l.productId && l.product);
  console.log(`  • Line Items with Valid FK:   ${linesWithProducts.length} / 262`);

  if (historicalInvoices.length === 81 && totalLines === 262) {
    console.log(`\n✅ 100% SUCCESS: All 81 historical invoices and 262 line items are verified in the database.`);
  } else {
    console.log(`\n⚠ Notice: Expected 81 invoices and 262 lines.`);
  }
}

verify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
