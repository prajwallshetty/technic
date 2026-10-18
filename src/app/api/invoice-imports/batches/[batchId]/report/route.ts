import { NextResponse } from "next/server";

import { errorStatus } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import type { Evaluation } from "@/lib/invoice-import/pipeline";
import type { DraftInvoice } from "@/lib/invoice-import/draft";

/**
 * Machine-readable extraction report for one batch: ?format=csv (default)
 * or ?format=json. One row per document with the extracted and the
 * independently calculated totals and every validation finding.
 */
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const user = await authorize("invoice_import.view");
    const firmId = requireFirmId(user);
    const { batchId } = await params;
    const batch = await prisma.invoiceImportBatch.findFirst({ where: { id: batchId, firmId } });
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const docs = await prisma.invoiceImportDocument.findMany({
      where: { batchId },
      select: {
        sourceFilename: true, sourcePath: true, status: true, direction: true, extractionMethod: true, pageCount: true,
        invoiceNumber: true, partyName: true, partyGstin: true, grandTotal: true, calculatedTotal: true, confidence: true,
        lastError: true, draft: true, evaluation: true, postedEntity: true, postedEntityId: true,
      },
    });
    const rows = docs
      .map((d) => {
        const draft = d.draft as unknown as DraftInvoice | null;
        const ev = d.evaluation as unknown as Evaluation | null;
        const issues = ev?.issues ?? [];
        return {
          source_filename: d.sourceFilename,
          source_path: d.sourcePath,
          document_type: draft?.documentType ?? null,
          direction: d.direction,
          extraction_method: d.extractionMethod,
          pages: d.pageCount,
          party: d.partyName,
          party_gstin: d.partyGstin,
          invoice_number: d.invoiceNumber,
          invoice_date: draft?.invoiceDate ?? null,
          line_items: draft?.lines.length ?? 0,
          matched_products: ev?.summary.matched ?? 0,
          suggested_products: ev?.summary.suggested ?? 0,
          unmatched_products: ev?.summary.unmatched ?? 0,
          missing_required_fields: issues.filter((i) => i.code === "REQUIRED_FIELD_MISSING").map((i) => i.field).join("; "),
          extracted_grand_total: d.grandTotal === null ? null : Number(d.grandTotal),
          calculated_grand_total: d.calculatedTotal === null ? null : Number(d.calculatedTotal),
          validation_differences: (ev?.reconciliation.checks ?? [])
            .filter((c) => c.ok === false)
            .map((c) => `${c.label}: ${c.difference}`)
            .join("; "),
          status: d.status,
          confidence: d.confidence === null ? null : Number(d.confidence),
          errors: issues.filter((i) => i.severity === "ERROR" && !i.details?.acknowledged).map((i) => i.message).join(" | ") || d.lastError || "",
          warnings: issues.filter((i) => i.severity === "WARNING").map((i) => i.message).join(" | "),
          draft_created: d.postedEntity ? `${d.postedEntity} ${d.postedEntityId}` : "",
        };
      })
      .sort((a, b) => a.source_filename.localeCompare(b.source_filename, undefined, { numeric: true }));

    const format = new URL(request.url).searchParams.get("format");
    const base = `invoice-import-${batch.createdAt.toISOString().slice(0, 10)}-${batch.id.slice(-6)}`;
    if (format === "json") {
      return new NextResponse(JSON.stringify({ batch: { id: batch.id, name: batch.name, skippedFiles: batch.skippedFiles }, documents: rows }, null, 2), {
        headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${base}.json"`, "Cache-Control": "private, no-store" },
      });
    }
    const header = Object.keys(rows[0] ?? { source_filename: "" });
    const escape = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header.join(","), ...rows.map((r) => header.map((h) => escape(r[h as keyof typeof r])).join(","))].join("\n") + "\n";
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: "Report unavailable" }, { status: errorStatus(error) });
  }
}
