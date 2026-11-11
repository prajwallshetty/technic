import Link from "next/link";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { STATES } from "@/lib/gst/gstr1/masters";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { listNotes } from "@/lib/services/credit-notes";
import { requirePermissionInFirm } from "@/lib/session";
import { NewNoteButton } from "./new-note-button";

export const metadata = { title: "Credit & Debit Notes — Technic Technologies" };

export default async function CreditNotesPage() {
  const user = await requirePermissionInFirm("invoice.view");
  const notes = await listNotes(user.activeFirmId);
  type Row = (typeof notes)[number];
  const columns: Column<Row>[] = [
    { key: "number", header: "Note #", cell: (r) => <Link href={`/credit-notes/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.noteNumber}</Link> },
    { key: "type", header: "Type", cell: (r) => (r.noteType === "CREDIT" ? "Credit" : "Debit") },
    { key: "date", header: "Date", hideOnMobile: true, cell: (r) => <span className="numeric">{formatDate(r.noteDate)}</span> },
    { key: "customer", header: "Customer", cell: (r) => <span className="line-clamp-1">{r.customer.name}</span> },
    { key: "invoice", header: "Against invoice", hideOnMobile: true, cell: (r) => r.originalInvoiceNumber ?? "—" },
    { key: "total", header: "Total", headerClassName: "text-right", className: "text-right numeric", cell: (r) => formatCurrency(r.totalAmount) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status === "CANCELLED" ? "CANCELLED" : "ISSUED"} dot /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Credit & Debit Notes"
        description="GST notes issued against invoices (section 34). They appear in GSTR-1 tables 9B and 13 and adjust the customer's ledger."
        actions={user.permissions.includes("invoice.create") ? <NewNoteButton states={Object.entries(STATES).map(([code, name]) => ({ code, name }))} /> : null}
      />
      <DataTable columns={columns} rows={notes} getRowKey={(r) => r.id} empty={<EmptyState title="No notes yet" description="Issue one against an invoice, or from an approved sales return." />} />
    </div>
  );
}
