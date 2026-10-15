"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { createCustomer } from "@/lib/services/partners";

interface CreateCustomerInput {
  name: string;
  phone: string;
  company?: string | null;
  email?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  type?: "RETAIL" | "BUSINESS" | "DEALER" | "CORPORATE" | "OTHER";
}

/**
 * Creates a customer from anywhere in the app (Customers page, POS counter…).
 * Everything is written in one place so the record is identical no matter
 * which screen created it.
 */
export async function createCustomerAction(input: CreateCustomerInput) {
  return runAction(async () => {
    const user = await authorize("customers.create");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const customer = await createCustomer({
      firmId,
      branchId,
      name: input.name,
      phone: input.phone,
      company: input.company ?? null,
      email: input.email ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      pincode: input.pincode ?? null,
      gstin: input.gstin ?? null,
      pan: input.pan ?? null,
      type: input.type,
      userId: user.id,
    });

    // Every screen that lists customers must pick the new record up.
    revalidatePath("/customers");
    revalidatePath("/pos");

    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      gstin: customer.gstin,
      state: customer.state,
    };
  });
}
