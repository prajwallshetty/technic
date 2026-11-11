import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { errorStatus, toActionResult } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { authorize, requireFirmId, resolveBranchScope } from "@/lib/session";
import { gstr1WorkbookBuffer } from "@/lib/gst/gstr1/excel";
import { buildGstr1Json } from "@/lib/gst/gstr1/json";
import { validateGstr1Json } from "@/lib/gst/gstr1/jsonSchema";
import { loadGstr1Input } from "@/lib/gst/gstr1/load";
import { buildGstr1 } from "@/lib/gst/gstr1/report";
import { gstr1SummaryPdf } from "@/lib/gst/gstr1/summaryPdf";

export const maxDuration = 120;

const OFFICIAL_SCHEMA = path.join(process.cwd(), "data", "gstr1-reference", "gstr1-schema.json");

/**
 * GET /api/gstr1/export?format=xlsx|json|pdf|issues&from=YYYY-MM-DD&to=YYYY-MM-DD[&gstin=][&acknowledge=1]
 *
 * The workbook always has the 14 sheets. When blocking issues remain it is only
 * released after the caller explicitly acknowledges them (acknowledge=1); the
 * portal JSON is never released while anything blocks it.
 */
export async function GET(request: Request) {
  try {
    const user = await authorize(["gst_reports.view"]);
    await authorize(["reports.export"]);
    const firmId = requireFirmId(user);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "xlsx";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return NextResponse.json({ error: "Choose a valid period (from ≤ to)." }, { status: 400 });
    }
    const scope = resolveBranchScope(user, null);
    const input = await loadGstr1Input({ firmId, from, to, gstin: url.searchParams.get("gstin") ?? undefined, ...(scope.branchId && scope.branchId !== "__no_branch__" ? { branchId: scope.branchId } : {}) });
    const rep = buildGstr1(input);
    const blocking = rep.issues.filter((i) => i.blocking && !i.jsonOnly);
    const stem = `GSTR1_${rep.firm.gstin}_${from.slice(0, 7) === to.slice(0, 7) ? rep.period.fp : `${from}_to_${to}`}`;
    const headers = (type: string, ext: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${stem}.${ext}"`, "Cache-Control": "private, no-store" });
    const audit = (what: string) => recordAudit({ action: "GSTR1_EXPORTED", entity: "GSTR1", summary: `${what} for ${rep.period.label} (${rep.firm.gstin}); ${rep.issues.filter((i) => i.severity === "ERROR").length} error(s), ${rep.issues.filter((i) => i.severity === "WARNING").length} warning(s)`, firmId, userId: user.id, after: { format, from, to, gstin: rep.firm.gstin, blocking: blocking.length } });

    if (format === "xlsx") {
      if (blocking.length && url.searchParams.get("acknowledge") !== "1") {
        return NextResponse.json({ error: `${blocking.length} unresolved issue(s) would make this return incorrect.`, code: "UNRESOLVED", blocking: blocking.length }, { status: 409 });
      }
      const buffer = await gstr1WorkbookBuffer(rep);
      await audit(`Excel exported${blocking.length ? ` with ${blocking.length} acknowledged blocking issue(s)` : ""}`);
      return new NextResponse(new Uint8Array(buffer), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
    }

    if (format === "json") {
      const built = buildGstr1Json(rep);
      if (!built.json) return NextResponse.json({ error: "The portal JSON cannot be produced until these are resolved.", blockers: built.blockers }, { status: 422 });
      const official = fs.existsSync(OFFICIAL_SCHEMA) ? JSON.parse(fs.readFileSync(OFFICIAL_SCHEMA, "utf8")) : null;
      const check = validateGstr1Json(built.json, official);
      if (!check.ok) return NextResponse.json({ error: "The generated JSON failed validation.", errors: check.errors }, { status: 500 });
      await audit(`Portal JSON exported (${check.checkedAgainst.official ? "official schema" : "built-in schema only"})`);
      return new NextResponse(JSON.stringify(built.json, null, 2), { headers: { ...headers("application/json", "json"), "X-Schema-Check": check.checkedAgainst.official ? "official" : "built-in-only" } });
    }

    if (format === "pdf") {
      const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { displayName: true, name: true } });
      const buffer = await gstr1SummaryPdf(rep, { generatedAt: new Date(), company: firm?.displayName || firm?.name || "" });
      await audit("Summary PDF exported");
      return new NextResponse(new Uint8Array(buffer), { headers: headers("application/pdf", "pdf") });
    }

    if (format === "issues") {
      const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = ["severity,code,blocking,document,field,message,how_to_fix",
        ...rep.issues.map((i) => [i.severity, i.code, i.blocking ? "yes" : "no", i.docNumber ? `${i.docKind ?? ""} ${i.docNumber}`.trim() : "", i.field ?? "", i.message, i.fix ?? ""].map(esc).join(","))].join("\n") + "\n";
      return new NextResponse(csv, { headers: headers("text/csv; charset=utf-8", "issues.csv") });
    }

    return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  } catch (error) {
    const result = toActionResult(error);
    return NextResponse.json({ error: result.ok ? "Unexpected error" : result.error }, { status: errorStatus(error) });
  }
}
