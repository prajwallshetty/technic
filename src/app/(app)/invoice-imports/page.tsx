import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { requirePermissionInFirm } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";
import { listBatches } from "@/lib/services/invoice-imports";
import { UploadInvoicesButton } from "./upload-button";

export const metadata = { title: "Invoice Import — Technic Technologies" };

export default async function InvoiceImportsPage() {
  const user = await requirePermissionInFirm("invoice_import.view");
  const canUpload = user.permissions.includes("invoice_import.manage");
  const batches = await listBatches(user.activeFirmId);
  type Row = (typeof batches)[number];

  const count = (row: Row, ...statuses: string[]) =>
    statuses.reduce((n, s) => n + (row.counts[s as keyof Row["counts"]] ?? 0), 0);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Upload",
      cell: (row) => (
        <Link href={`/invoice-imports/${row.id}`} className="font-medium hover:text-primary hover:underline">
          <span className="line-clamp-1">{row.name}</span>
        </Link>
      ),
    },
    { key: "date", header: "Uploaded", hideOnMobile: true, cell: (row) => <span className="numeric">{formatDateTime(row.createdAt)}</span> },
    { key: "docs", header: "Documents", className: "numeric", cell: (row) => row.documents },
    { key: "ready", header: "Ready", hideOnMobile: true, className: "numeric", cell: (row) => count(row, "READY") },
    { key: "review", header: "Needs review", hideOnMobile: true, className: "numeric", cell: (row) => count(row, "NEEDS_REVIEW", "DUPLICATE") },
    { key: "failed", header: "Failed", hideOnMobile: true, className: "numeric", cell: (row) => count(row, "FAILED") },
    { key: "done", header: "Approved", hideOnMobile: true, className: "numeric", cell: (row) => count(row, "APPROVED", "POSTED") },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoice Import"
        description="Upload invoice PDFs, scans or ZIP archives. Extracted data is checked against the printed totals and your catalogue, then reviewed before anything reaches the books."
        actions={canUpload ? <UploadInvoicesButton /> : null}
      />
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Approving an import never changes stock or posts money. Supplier invoices become <strong>draft purchase orders</strong>; stock moves only
        when goods are received in Purchases. Sales invoices issued by this firm are kept as reviewed records.
      </div>
      <DataTable
        columns={columns}
        rows={batches}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No imports yet" description="Upload invoice PDFs or a ZIP archive to start." />}
      />
    </div>
  );
}
