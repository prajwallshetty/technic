import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type { ProductResolution } from "./types";

interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  hsnCode: string | null;
  sellingPrice: number;
}

export class ProductMatcher {
  private firmId: string;
  private productsBySku = new Map<string, ProductRecord>();
  private productsByBarcode = new Map<string, ProductRecord>();
  private explicitMappings = new Map<string, string>(); // raw description/key -> SKU

  constructor(firmId: string) {
    this.firmId = firmId;
  }

  /**
   * Loads products from database and optional explicit mapping JSON file.
   */
  async init(dataDir?: string): Promise<void> {
    const products = await prisma.product.findMany({
      where: { firmId: this.firmId, status: "ACTIVE" },
      select: {
        id: true,
        sku: true,
        name: true,
        barcode: true,
        hsnCode: true,
        sellingPrice: true,
      },
    });

    for (const p of products) {
      const rec: ProductRecord = {
        id: p.id,
        sku: p.sku.trim().toUpperCase(),
        name: p.name,
        barcode: p.barcode?.trim() || null,
        hsnCode: p.hsnCode?.trim() || null,
        sellingPrice: Number(p.sellingPrice),
      };
      this.productsBySku.set(rec.sku, rec);
      if (rec.barcode) {
        this.productsByBarcode.set(rec.barcode, rec);
      }
    }

    // Load optional explicit mapping file if it exists
    if (dataDir) {
      const mappingPath = path.join(dataDir, "product-mappings.json");
      if (fs.existsSync(mappingPath)) {
        try {
          const mappingJson = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
          if (typeof mappingJson === "object" && mappingJson !== null) {
            for (const [k, v] of Object.entries(mappingJson)) {
              if (typeof v === "string") {
                this.explicitMappings.set(k.trim().toUpperCase(), v.trim().toUpperCase());
              }
            }
          }
        } catch (e) {
          console.warn("Failed to parse product-mappings.json:", e);
        }
      }
    }
  }

  /**
   * Matches an invoice item against existing products.
   * Strictly adheres to Rule 5:
   * - Does NOT match solely on vague name similarity.
   * - Matches on SKU, Barcode, or Explicit mapping table.
   * - Returns UNRESOLVED if confident match cannot be found.
   */
  resolveProduct(description: string, hsnCode?: string | null): ProductResolution {
    const cleanDesc = description.trim().toUpperCase();

    // 1. Direct SKU match
    if (this.productsBySku.has(cleanDesc)) {
      const prod = this.productsBySku.get(cleanDesc)!;
      return {
        status: "MATCHED",
        productId: prod.id,
        sku: prod.sku,
        productName: prod.name,
        hsnCode: prod.hsnCode ?? undefined,
        confidence: "HIGH",
        method: "SKU_EXACT",
      };
    }

    // 2. Explicit Administrator Mapping Match
    if (this.explicitMappings.has(cleanDesc)) {
      const mappedSku = this.explicitMappings.get(cleanDesc)!;
      if (this.productsBySku.has(mappedSku)) {
        const prod = this.productsBySku.get(mappedSku)!;
        return {
          status: "MATCHED",
          productId: prod.id,
          sku: prod.sku,
          productName: prod.name,
          hsnCode: prod.hsnCode ?? undefined,
          confidence: "HIGH",
          method: "MAPPING_TABLE",
        };
      }
    }

    // 3. Unresolved
    return {
      status: "UNRESOLVED",
      confidence: "NONE",
      reason: `No matching product with SKU or mapped identifier found for item '${description}' (HSN: ${hsnCode || "—"}). Schema requires Product relation; manual catalog mapping required.`,
    };
  }

  /**
   * Resolves or auto-catalogs a product if autoCatalog is enabled.
   */
  async resolveOrCreateProduct(
    description: string,
    hsnCode?: string | null,
    gstRate = 18,
    rate = 0,
    autoCatalog = false,
    dryRun = false,
  ): Promise<ProductResolution> {
    const existing = this.resolveProduct(description, hsnCode);
    if (existing.status === "MATCHED" || !autoCatalog) {
      return existing;
    }

    const cleanDesc = description.trim();
    // Unique slug for historical SKU
    const slug = cleanDesc
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24);
    const sku = `HIST-${slug || "PROD"}`;

    if (this.productsBySku.has(sku)) {
      const prod = this.productsBySku.get(sku)!;
      return {
        status: "MATCHED",
        productId: prod.id,
        sku: prod.sku,
        productName: prod.name,
        hsnCode: prod.hsnCode ?? undefined,
        confidence: "HIGH",
        method: "SKU_EXACT",
      };
    }

    if (dryRun) {
      const simId = `sim_prod_${sku}`;
      const rec: ProductRecord = {
        id: simId,
        sku,
        name: cleanDesc,
        barcode: null,
        hsnCode: hsnCode || null,
        sellingPrice: rate,
      };
      this.productsBySku.set(sku, rec);
      this.productsBySku.set(cleanDesc.toUpperCase(), rec);
      return {
        status: "MATCHED",
        productId: simId,
        sku,
        productName: cleanDesc,
        hsnCode: hsnCode || undefined,
        confidence: "HIGH",
        method: "SKU_EXACT",
      };
    }

    try {
      const product = await prisma.product.create({
        data: {
          firmId: this.firmId,
          sku,
          name: cleanDesc,
          hsnCode: hsnCode || null,
          gstRate,
          sellingPrice: rate,
          purchasePrice: rate,
          unit: "pcs",
          status: "ACTIVE",
          description: "Imported from historical invoice catalog",
        },
      });

      const rec: ProductRecord = {
        id: product.id,
        sku: product.sku,
        name: product.name,
        barcode: null,
        hsnCode: product.hsnCode,
        sellingPrice: Number(product.sellingPrice),
      };
      this.productsBySku.set(sku, rec);
      this.productsBySku.set(cleanDesc.toUpperCase(), rec);

      return {
        status: "MATCHED",
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        hsnCode: product.hsnCode || undefined,
        confidence: "HIGH",
        method: "SKU_EXACT",
      };
    } catch (e) {
      return {
        status: "UNRESOLVED",
        confidence: "NONE",
        reason: `Failed to auto-catalog product '${description}': ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}
