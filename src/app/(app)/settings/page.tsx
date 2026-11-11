import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";

export const metadata = { title: "Settings — Technic Technologies" };

export default async function SettingsPage() {
  const user = await requirePermissionInFirm("settings.manage");

  const [firm, settings] = await Promise.all([
    prisma.firm.findUnique({ where: { id: user.activeFirmId } }),
    prisma.setting.findMany({ where: { firmId: user.activeFirmId } }),
  ]);

  const map = new Map(settings.map((setting) => [setting.key, setting.value]));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Settings"
        description="Company profile, document numbering and bank details used on printed documents"
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Documents & branding</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            firmName={firm?.displayName || firm?.name || ""}
            gstin={firm?.gstin ?? ""}
            initialValues={{
              company_phone: map.get("company_phone") ?? firm?.phone ?? "",
              company_email: map.get("company_email") ?? firm?.email ?? "",
              company_website: map.get("company_website") ?? firm?.website ?? "",
              company_bank_details: map.get("company_bank_details") ?? "",
              document_terms: map.get("document_terms") ?? "",
              document_footer_text: map.get("document_footer_text") ?? "",
              sequence_invoice_gst: map.get("sequence_invoice_gst") ?? "TT/GST/{FY}/",
              sequence_invoice_non_gst: map.get("sequence_invoice_non_gst") ?? "TT/NG/{FY}/",
              gst_trade_name: map.get("gst_trade_name") ?? "",
              gst_aato_band: map.get("gst_aato_band") ?? "",
              gst_turnover_prev_fy: map.get("gst_turnover_prev_fy") ?? "",
              gst_turnover_cur_fy: map.get("gst_turnover_cur_fy") ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
