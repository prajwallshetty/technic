import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/shared/page-header";
import { requirePermissionInFirm } from "@/lib/session";
import { canBillGst } from "@/lib/access-mode";
import { isPlatformRole } from "@/lib/rbac";
import { PosTerminal } from "./pos-terminal";

export const metadata = { title: "Point of Sale — Technic Technologies" };

export default async function PosPage() {
  const user = await requirePermissionInFirm(["invoice.create", "sales.create"]);
  const firmId = user.activeFirmId;
  const mode = canBillGst(user) ? "GST" : "NON_GST";
  const canSwitchMode = isPlatformRole(user.role);

  const [products, customers] = await Promise.all([
    prisma.product.findMany({
      where: { firmId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        subName: true,
        sku: true,
        barcode: true,
        hsnCode: true,
        gstRate: true,
        sellingPrice: true,
        trackSerials: true,
        trackImei: true,
        brand: { select: { name: true } },
        variants: {
          where: { isActive: true },
          select: { id: true, name: true, sku: true, sellingPrice: true },
        },
      },
      orderBy: { name: "asc" },
      take: 300,
    }),
    prisma.customer.findMany({
      where: { firmId, isActive: true },
      select: { id: true, code: true, name: true, phone: true, gstin: true, state: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Point of Sale"
        description="Scan a barcode or search the catalogue to create a sale"
      />
      <PosTerminal
        mode={mode}
        branchId={user.branchId ?? ""}
        canSwitchMode={canSwitchMode}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          subName: product.subName,
          sku: product.sku,
          barcode: product.barcode,
          hsnCode: product.hsnCode,
          gstRate: Number(product.gstRate),
          sellingPrice: Number(product.sellingPrice),
          trackSerials: product.trackSerials,
          trackImei: product.trackImei,
          brand: product.brand,
          variants: product.variants.map((variant) => ({
            id: variant.id,
            name: variant.name,
            sku: variant.sku,
            sellingPrice: Number(variant.sellingPrice),
          })),
        }))}
        customers={customers}
        canCollectPayment={user.permissions.includes("payments.create")}
        canCreateCustomer={user.permissions.includes("customers.create")}
      />
    </div>
  );
}
