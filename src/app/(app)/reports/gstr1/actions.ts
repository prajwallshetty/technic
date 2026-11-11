"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import {
  setCustomerGstTreatment,
  setHsnForProductLines,
  updateInvoiceGstDetails,
  updateInvoiceLineGstDetails,
  type InvoiceGstInput,
  type LineGstInput,
} from "@/lib/services/gst-corrections";

/** Corrections from the GSTR-1 validation screen. GST classification fields only — never amounts. */
export async function fixInvoiceGstAction(invoiceId: string, input: InvoiceGstInput) {
  return runAction(async () => {
    const user = await authorize("invoice.edit");
    await updateInvoiceGstDetails({ firmId: requireFirmId(user), userId: user.id }, invoiceId, input);
    revalidatePath("/reports/gstr1");
  });
}

export async function fixLineGstAction(lineId: string, input: LineGstInput) {
  return runAction(async () => {
    const user = await authorize("invoice.edit");
    await updateInvoiceLineGstDetails({ firmId: requireFirmId(user), userId: user.id }, lineId, input);
    revalidatePath("/reports/gstr1");
  });
}

export async function bulkHsnAction(productId: string, input: { hsnCode: string; uqc?: string | null; updateProduct?: boolean }) {
  return runAction(async () => {
    const user = await authorize("invoice.edit");
    const result = await setHsnForProductLines({ firmId: requireFirmId(user), userId: user.id }, productId, input);
    revalidatePath("/reports/gstr1");
    return result;
  });
}

export async function setTreatmentAction(customerId: string, treatment: Parameters<typeof setCustomerGstTreatment>[2]) {
  return runAction(async () => {
    const user = await authorize("customers.edit");
    await setCustomerGstTreatment({ firmId: requireFirmId(user), userId: user.id }, customerId, treatment);
    revalidatePath("/reports/gstr1");
  });
}
