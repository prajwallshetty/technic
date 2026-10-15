import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";

const FIRM_ID = "firm_technic_main";

async function main() {
  const catalogPath = path.join(process.cwd(), "data", "historical-csv", "catalog-products.json");
  const products = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));

  console.log(`Checking existing products for firm ${FIRM_ID}...`);
  const existingList = await prisma.product.findMany({
    where: { firmId: FIRM_ID },
    select: { id: true, sku: true },
  });
  const existingMap = new Map(existingList.map((p) => [p.sku.toUpperCase(), p.id]));
  console.log(`Found ${existingList.length} existing products in firm.`);

  const toCreate = products.filter((p: any) => !existingMap.has(p.sku.toUpperCase()));
  const toUpdate = products.filter((p: any) => existingMap.has(p.sku.toUpperCase()));

  console.log(`To create: ${toCreate.length}, To update: ${toUpdate.length}`);

  let created = 0;
  if (toCreate.length > 0) {
    const res = await prisma.product.createMany({
      data: toCreate.map((p: any) => ({
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
      })),
      skipDuplicates: true,
    });
    created = res.count;
  }

  let updated = 0;
  for (const p of toUpdate) {
    const id = existingMap.get(p.sku.toUpperCase())!;
    await prisma.product.update({
      where: { id },
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
  }

  console.log(`Product catalog seeded: ${created} created, ${updated} updated.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
