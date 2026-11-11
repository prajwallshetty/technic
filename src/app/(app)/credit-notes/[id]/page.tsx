import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { NotFoundError } from "@/lib/action-result";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { getNote } from "@/lib/services/credit-notes";
import { requirePermissionInFirm } from "@/lib/session";
import { CancelNoteButton } from "./cancel-note-button";

export const metadata = { title: "Credit / Debit Note — Technic Technologies" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("invoice.view");
  const { id } = await params;
  let note;
  try {
    note = await getNote(user.activeFirmId, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const kind = note.noteType === "CREDIT" ? "Credit" : "Debit";
  const money = (v: unknown) => formatCurrency(Number(v));
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${kind} note ${note.noteNumber}`}
        description={`${formatDate(note.noteDate)} · ${note.customer.name}${note.billToGstin ? ` · GSTIN ${note.billToGstin}` : ""}`}
        backButton={<Link href="/credit-notes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All notes</Link>}
        actions={<><StatusBadge status={note.status === "CANCELLED" ? "CANCELLED" : "ISSUED"} dot />{note.status === "ISSUED" && user.permissions.includes("invoice.cancel") ? <CancelNoteButton noteId={note.id} /> : null}</>}
      />
      <div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Against invoice</p><p>{note.originalInvoice ? <Link className="text-primary hover:underline" href={`/invoices/${note.originalInvoice.id}`}>{note.originalInvoiceNumber}</Link> : (note.originalInvoiceNumber ?? "—")}</p></div>
        <div><p className="text-xs text-muted-foreground">Reason</p><p>{note.reason.replace(/_/g, " ").toLowerCase()}{note.reasonText ? ` — ${note.reasonText}` : ""}</p></div>
        <div><p className="text-xs text-muted-foreground">Place of supply</p><p>{note.placeOfSupplyCode ? `${note.placeOfSupplyCode}-${note.placeOfSupply}` : "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Supply type / reverse charge</p><p>{note.supplyType.replace(/_/g, " ").toLowerCase()} · {note.reverseCharge ? "Y" : "N"}</p></div>
      </div>
      {note.status === "CANCELLED" ? <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">Cancelled: {note.cancellationReason}. It no longer appears in the GST return, and its ledger effect has been reversed.</p> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">Item</th><th className="px-3 py-1.5 text-left">HSN</th><th className="px-3 py-1.5 text-right">Qty</th><th className="px-3 py-1.5 text-right">Taxable</th><th className="px-3 py-1.5 text-right">GST %</th><th className="px-3 py-1.5 text-right">CGST</th><th className="px-3 py-1.5 text-right">SGST</th><th className="px-3 py-1.5 text-right">IGST</th><th className="px-3 py-1.5 text-right">Total</th></tr></thead>
          <tbody>
            {note.lines.map((l) => (
              <tr key={l.id} className="border-t"><td className="px-3 py-1.5">{l.description}</td><td className="px-3 py-1.5 font-mono text-xs">{l.hsnCode ?? "—"}</td><td className="numeric px-3 py-1.5 text-right">{l.quantity}</td><td className="numeric px-3 py-1.5 text-right">{money(l.taxableValue)}</td><td className="numeric px-3 py-1.5 text-right">{Number(l.gstRate)}</td><td className="numeric px-3 py-1.5 text-right">{money(l.cgstAmount)}</td><td className="numeric px-3 py-1.5 text-right">{money(l.sgstAmount)}</td><td className="numeric px-3 py-1.5 text-right">{money(l.igstAmount)}</td><td className="numeric px-3 py-1.5 text-right">{money(l.lineTotal)}</td></tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-medium"><tr><td className="px-3 py-1.5" colSpan={3}>Total</td><td className="numeric px-3 py-1.5 text-right">{money(note.taxableAmount)}</td><td /><td className="numeric px-3 py-1.5 text-right">{money(note.cgstAmount)}</td><td className="numeric px-3 py-1.5 text-right">{money(note.sgstAmount)}</td><td className="numeric px-3 py-1.5 text-right">{money(note.igstAmount)}</td><td className="numeric px-3 py-1.5 text-right">{money(note.totalAmount)}{Number(note.roundOff) ? <span className="block text-xs font-normal text-muted-foreground">incl. round-off {money(note.roundOff)}</span> : null}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
