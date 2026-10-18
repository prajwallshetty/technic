import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/action-result";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { requirePermissionInFirm } from "@/lib/session";
import { getBatchProgress, listBatchDocuments } from "@/lib/services/invoice-imports";
import { BatchProgress } from "./batch-progress";

export const metadata = { title: "Invoice Import — Technic Technologies" };

export default async function ImportBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const user = await requirePermissionInFirm("invoice_import.view");
  const { batchId } = await params;

  let data;
  try {
    data = await listBatchDocuments(user.activeFirmId, batchId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const progress = await getBatchProgress(user.activeFirmId, batchId);
  const skipped = (data.batch.skippedFiles as Array<{ path: string; reason: string }> | null) ?? [];
  type Row = (typeof data.documents)[number];

  const columns: Column<Row>[] = [
    {
      key: "file",
      header: "File",
      cell: (row) => (
        <Link href={`/invoice-imports/documents/${row.id}`} className="font-medium hover:text-primary hover:underline">
          {row.sourceFilename}
        </Link>
      ),
    },
    { key: "type", header: "Type", hideOnMobile: true, cell: (row) => <span className="text-xs">{row.direction === "UNKNOWN" ? "—" : row.direction.toLowerCase()}</span> },
    { key: "party", header: "Party", hideOnMobile: true, cell: (row) => <span className="line-clamp-1">{row.partyName ?? "—"}</span> },
    { key: "number", header: "Invoice #", cell: (row) => row.invoiceNumber ?? "—" },
    { key: "date", header: "Date", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDate(row.invoiceDate)}</span> },
    {
      key: "lines",
      header: "Lines (matched)",
      hideOnMobile: true,
      className: "numeric",
      cell: (row) =>
        row.lineSummary ? (
          <span title={`${row.lineSummary.matched} matched, ${row.lineSummary.suggested} to confirm, ${row.lineSummary.unmatched} not found`}>
            {row.lineSummary.itemLines + row.lineSummary.adjustmentLines} ({row.lineSummary.matched}/{row.lineSummary.itemLines})
          </span>
        ) : (
          "—"
        ),
    },
    { key: "total", header: "Extracted total", headerClassName: "text-right", className: "text-right numeric", cell: (row) => (row.grandTotal === null ? "—" : formatCurrency(row.grandTotal)) },
    {
      key: "calc",
      header: "Calculated",
      hideOnMobile: true,
      headerClassName: "text-right",
      className: "text-right numeric",
      cell: (row) => {
        if (row.calculatedTotal === null) return "—";
        const differs = row.grandTotal !== null && Math.abs(row.grandTotal - row.calculatedTotal) > 0.009;
        return <span className={differs ? "font-semibold text-destructive" : undefined}>{formatCurrency(row.calculatedTotal)}</span>;
      },
    },
    {
      key: "issues",
      header: "Issues",
      hideOnMobile: true,
      cell: (row) =>
        row.status === "FAILED" ? (
          <span className="line-clamp-2 text-xs text-destructive">{row.lastError}</span>
        ) : (
          <span className="text-xs">
            {row.errorCount ? <span className="text-destructive">{row.errorCount} error(s)</span> : null}
            {row.errorCount && row.warningCount ? " · " : null}
            {row.warningCount ? <span className="text-warning-foreground">{row.warningCount} warning(s)</span> : null}
            {!row.errorCount && !row.warningCount ? "—" : null}
          </span>
        ),
    },
    {
      key: "confidence",
      header: "Confidence",
      hideOnMobile: true,
      className: "numeric",
      cell: (row) => (row.confidence === null ? "—" : <ConfidencePill value={row.confidence} />),
    },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.batch.name}
        description={`Uploaded ${formatDate(data.batch.createdAt)} · ${progress.total} document(s)`}
        backButton={
          <Link href="/invoice-imports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> All imports
          </Link>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/invoice-imports/batches/${batchId}/report?format=csv`}>
                <Download className="size-4" /> Report (CSV)
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/invoice-imports/batches/${batchId}/report?format=json`}>JSON</a>
            </Button>
          </>
        }
      />
      <BatchProgress batchId={batchId} initial={progress} />
      {skipped.length ? (
        <details className="rounded-lg border border-border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">{skipped.length} file(s) not imported</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {skipped.slice(0, 200).map((s) => (
              <li key={s.path}>
                <span className="font-mono text-xs">{s.path}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <DataTable
        columns={columns}
        rows={data.documents}
        getRowKey={(row) => row.id}
        rowClassName={(row) => (row.status === "FAILED" || row.status === "DUPLICATE" ? "bg-destructive/5" : row.status === "NEEDS_REVIEW" ? "bg-warning/5" : undefined)}
      />
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const tone = value >= 0.9 ? "text-success" : value >= 0.7 ? "text-warning-foreground" : "text-destructive";
  return <span className={tone}>{Math.round(value * 100)}%</span>;
}
