"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const ALLOWED_KEYS = new Set([
  "company_phone",
  "company_email",
  "company_website",
  "company_bank_details",
  "document_terms",
  "document_footer_text",
  "sequence_invoice_gst",
  "sequence_invoice_non_gst",
  // GST return (GSTR-1) details
  "gst_trade_name",
  "gst_aato_band",
  "gst_turnover_prev_fy",
  "gst_turnover_cur_fy",
]);

export async function saveSettingsAction(input: { values: Record<string, string> }) {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const firmId = requireFirmId(user);

    const entries = Object.entries(input.values).filter(([key]) => ALLOWED_KEYS.has(key));

    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { firmId_key: { firmId, key } },
        create: {
          firmId,
          key,
          value,
          category: key.startsWith("sequence_") ? "documents" : key.startsWith("gst_") ? "gst" : key === "company_bank_details" ? "company" : "documents",
        },
        update: { value },
      });
    }

    await recordAudit({
      action: "SETTING_UPDATED",
      entity: "Setting",
      summary: `Updated ${entries.length} setting(s)`,
      firmId,
      userId: user.id,
    });

    revalidatePath("/settings");
    return { saved: entries.length };
  });
}
