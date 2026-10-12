import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";

const FIRM_ID = "firm_technic_main";

async function main() {
  const catalogPath = path.join(process.cwd(), "data", "historical-csv", "catalog-products.json");
  const products = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));

  console.log(`Seeding ${products.length} historical products into database...`);

  let created = 0;
  let updated = 0;

  for (const p of products) {
    const existing = await prisma.product.findFirst({
      where: { firmId: FIRM_ID, sku: p.sku },
    });

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          name: p.name,
          hsnCode: p.hsn || null,
          gstRate: p.gst || 18,
          purchasePrice: p.rate || 0,
          sellingPrice: p.rate || 0,
          status: "ACTIVE",
        },
      });
      updated++;
    } else {
      await prisma.product.create({
        data: {
          firmId: FIRM_ID,
          sku: p.sku,
          name: p.name,
          hsnCode: p.hsn || null,
          gstRate: p.gst || 18,
          purchasePrice: p.rate || 0,
          sellingPrice: p.rate || 0,
          unit: "pcs",
          status: "ACTIVE",
          description: "Historical invoice product catalog",
        },
      });
      created++;
    }
  }

  console.log(`Product catalog seeded: ${created} created, ${updated} updated.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
