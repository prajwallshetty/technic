import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listInvoices } from "@/lib/services/invoice-list";
import { DeleteInvoiceButton } from "./delete-invoice-button";
import { requirePermissionInFirm } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { INVOICE_STATUS_LABELS } from "@/lib/workflow";
import { parsePageParam, buildQuery } from "@/lib/utils";

export const metadata = { title: "Invoices — Technic Technologies" };

interface Row {
  id: string;
  invoiceNumber: string;
  kind: string;
  status: string;
  invoiceDate: Date;
  customerName: string;
  total: number;
  due: number;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("invoice.view");
  const params = await searchParams;
  const page = parsePageParam(params.page);

  const { invoices, total, pageSize } = await listInvoices(user, {
    q: params.q,
    status: params.status,
    kind: params.kind,
    from: params.from,
    to: params.to,
    page,
  });

  const columns: Column<Row>[] = [
    {
      key: "number",
      header: "Invoice #",
      cell: (row) => (
        <Link href={`/invoices/${row.id}`} className="font-medium hover:text-primary hover:underline">
          {row.invoiceNumber}
        </Link>
      ),
    },
    {
      key: "kind",
      header: "Type",
      hideOnMobile: true,
      cell: (row) => (
        <Badge tone={row.kind === "TAX_INVOICE" ? "info" : "neutral"}>
          {row.kind === "TAX_INVOICE" ? "Tax Invoice" : "Non-Tax Invoice"}
        </Badge>
      ),
    },
    { key: "customer", header: "Customer", cell: (row) => <span className="line-clamp-1">{row.customerName}</span> },
    {
      key: "date",
      header: "Date",
      hideOnMobile: true,
      cell: (row) => <span className="numeric">{formatDate(row.invoiceDate)}</span>,
    },
    {
      key: "total",
      header: "Total",
      headerClassName: "text-right",
      className: "text-right numeric",
      cell: (row) => formatCurrency(row.total),
    },
    {
      key: "due",
      header: "Balance",
      headerClassName: "text-right",
      className: "text-right numeric",
      hideOnMobile: true,
      cell: (row) => (row.due > 0 ? formatCurrency(row.due) : "—"),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge status={row.status} label={INVOICE_STATUS_LABELS[row.status] ?? row.status} dot />
      ),
    },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.status !== "CANCELLED" && canEdit ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/invoices/${row.id}?edit=true`}>Edit</Link>
            </Button>
          ) : null}
          {canDelete ? (
            <DeleteInvoiceButton
              invoiceId={row.id}
              invoiceNumber={row.invoiceNumber}
              isCancelled={row.status === "CANCELLED"}
              size="sm"
              variant="outline"
            />
          ) : null}
        </div>
      ),
    },
  ];

  const canEdit =
    user.permissions.includes("invoice.create") ||
    user.permissions.includes("sales.edit") ||
    user.permissions.includes("invoice.edit");
  const canDelete =
    user.permissions.includes("invoice.delete") ||
    user.permissions.includes("sales.edit") ||
    user.permissions.includes("invoice.edit");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="Tax invoices and bills issued by your firm"
        actions={
          <>
            {user.permissions.includes("reports.export") ? (
              <Button asChild variant="outline">
                <a href={`/api/export?type=invoices&${new URLSearchParams(
                  Object.entries(params)
                    .filter(([key, value]) => value && ["q", "status", "kind", "from", "to"].includes(key))
                    .map(([key, value]) => [key, value as string]),
                ).toString()}`}>Export CSV</a>
              </Button>
            ) : null}
            {user.permissions.includes("sales.create") || user.permissions.includes("invoice.create") ? (
              <Button asChild>
                <Link href="/pos">New sale</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Invoice #, customer…"
        showDateRange
        filters={[
          {
            name: "kind",
            label: "Type",
            options: [
              { value: "GST", label: "Tax Invoice" },
              { value: "NON_GST", label: "Non-Tax Invoice" },
            ],
          },
          {
            name: "status",
            label: "Status",
            options: [
              { value: "ISSUED", label: "Issued" },
              { value: "PARTIALLY_PAID", label: "Partially paid" },
              { value: "PAID", label: "Paid" },
              { value: "CANCELLED", label: "Cancelled" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={invoices}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            title="No invoices found"
            description="Raise your first sale from the POS."
            action={
              <Button asChild size="sm">
                <Link href="/pos">Open POS</Link>
              </Button>
            }
          />
        }
        renderMobileCard={(row) => (
          <div className="space-y-1.5">
            <Link href={`/invoices/${row.id}`} className="block space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.invoiceNumber}</span>
                <StatusBadge status={row.status} label={INVOICE_STATUS_LABELS[row.status] ?? row.status} />
              </div>
              <p className="text-sm text-muted-foreground">{row.customerName}</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{formatDate(row.invoiceDate)}</span>
                <span className="numeric font-semibold">{formatCurrency(row.total)}</span>
              </div>
            </Link>
            {row.status !== "CANCELLED" && canEdit ? (
              <Button asChild size="sm" variant="outline" className="w-full">
                <Link href={`/invoices/${row.id}?edit=true`}>Edit invoice</Link>
              </Button>
            ) : null}
          </div>
        )}
      />

      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
