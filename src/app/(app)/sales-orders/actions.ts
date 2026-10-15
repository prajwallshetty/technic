"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { firmDefaultMode } from "@/lib/access-mode";
import { createSalesOrder } from "@/lib/services/sales";

export async function createSalesOrderAction(input: {
  customerId: string;
  expectedDate?: string | null;
  notes?: string | null;
  lines: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    gstRate?: number;
  }[];
}) {
  return runAction(async () => {
    const user = await authorize("sales.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    if (!input.customerId) throw new Error("Select a customer");
    if (!input.lines?.length) throw new Error("Add at least one item to the order");

    // expectedDate maps onto validUntil in the service (used as the order's
    // expected-by date for sales orders).
    const order = await createSalesOrder({
      firmId,
      branchId,
      customerId: input.customerId,
      taxMode: await firmDefaultMode(firmId),
      validUntil: input.expectedDate ? new Date(input.expectedDate) : null,
      notes: input.notes ?? null,
      lines: input.lines,
      userId: user.id,
    });

    revalidatePath("/sales-orders");
    revalidatePath("/dashboard");
    return { orderNumber: order.orderNumber, id: order.id };
  });
}
