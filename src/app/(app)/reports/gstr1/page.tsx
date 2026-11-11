import { PageHeader } from "@/components/shared/page-header";
import { requirePermissionInFirm, resolveBranchScope } from "@/lib/session";
import { gstinOptions, loadGstr1Input } from "@/lib/gst/gstr1/load";
import { buildGstr1Json } from "@/lib/gst/gstr1/json";
import { buildGstr1, periodFor } from "@/lib/gst/gstr1/report";
import { SHEET_NAMES, toSheetModels } from "@/lib/gst/gstr1/sheets";
import { STATES, UQC_LIST } from "@/lib/gst/gstr1/masters";
import { Gstr1View } from "./gstr1-view";

export const metadata = { title: "GSTR-1 — Technic Technologies" };

/** First day / last day of a calendar month, as yyyy-mm-dd. */
function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
}

function financialYearOptions(now = new Date()) {
  const start = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, i) => start - i).map((y) => ({ value: String(y), label: `${y}-${String((y + 1) % 100).padStart(2, "0")}` }));
}

export default async function Gstr1Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermissionInFirm("gst_reports.view");
  const params = await searchParams;
  const options = await gstinOptions(user.activeFirmId);
  const fyOptions = financialYearOptions();

  let from = "";
  let to = "";
  if (params.from && params.to) ({ from, to } = { from: params.from, to: params.to });
  else if (params.month) ({ from, to } = monthBounds(params.month));
  else if (params.fy) ({ from, to } = { from: `${params.fy}-04-01`, to: `${Number(params.fy) + 1}-03-31` });

  const controls = { fy: params.fy ?? "", month: params.month ?? "", from: params.from ?? "", to: params.to ?? "", gstin: params.gstin ?? options[0]?.gstin ?? "" };
  const canExport = user.permissions.includes("reports.export");
  const canFix = user.permissions.includes("invoice.edit");

  let data: React.ComponentProps<typeof Gstr1View>["data"] = null;
  if (from && to && from <= to) {
    const scope = resolveBranchScope(user, null);
    const input = await loadGstr1Input({ firmId: user.activeFirmId, from, to, gstin: controls.gstin || undefined, ...(scope.branchId && scope.branchId !== "__no_branch__" ? { branchId: scope.branchId } : {}) });
    const report = buildGstr1(input);
    const json = buildGstr1Json(report);
    const previews = toSheetModels(report).map((m) => ({ name: m.name, totalRows: m.rows.length, rows: m.rows.slice(0, 200) }));
    data = {
      period: periodFor(from, to),
      firm: report.firm,
      totals: report.totals,
      issues: report.issues,
      reconciliation: report.reconciliation,
      docs: report.docs,
      rules: report.rulesApplied,
      previews,
      jsonBlockers: json.blockers,
    };
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="GSTR-1"
        description="Outward supplies return built from your actual invoices and notes. Review the checks, correct anything flagged, then download."
      />
      <Gstr1View
        controls={controls}
        fyOptions={fyOptions}
        gstins={options}
        data={data}
        canExport={canExport}
        canFix={canFix}
        sheetNames={[...SHEET_NAMES]}
        states={Object.entries(STATES).map(([code, name]) => ({ code, name }))}
        uqcs={UQC_LIST.map((u) => ({ code: u.split("-")[0], label: u }))}
      />
    </div>
  );
}
