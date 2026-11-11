"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createNoteAction, invoiceLinesForNoteAction, searchInvoicesForNoteAction } from "./actions";

const REASONS: [string, string][] = [
  ["SALES_RETURN", "Sales return"], ["POST_SALE_DISCOUNT", "Post-sale discount"], ["DEFICIENCY_IN_SERVICES", "Deficiency in services"],
  ["CORRECTION_IN_INVOICE", "Correction in invoice"], ["CHANGE_IN_POS", "Change in place of supply"], ["FINALIZATION_OF_PROVISIONAL_ASSESSMENT", "Finalisation of provisional assessment"], ["OTHERS", "Others"],
];

interface InvoiceHit { id: string; number: string; date: string; customer: string; total: number; customerId: string }
interface LineInfo { id: string; description: string; hsn: string | null; quantity: number; remaining: number; taxable: number; rate: number }

export function NewNoteButton({ states }: { states: { code: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [noteType, setNoteType] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<InvoiceHit[]>([]);
  const [chosen, setChosen] = useState<{ invoice: { id: string; number: string; customerId: string; placeOfSupplyCode: string | null; placeOfSupply: string | null; date: string }; lines: LineInfo[] } | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("SALES_RETURN");
  const [reasonText, setReasonText] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [pos, setPos] = useState("");

  async function search() {
    const r = await searchInvoicesForNoteAction(query);
    if (r.ok) setHits(r.data);
  }
  async function pick(h: InvoiceHit) {
    const r = await invoiceLinesForNoteAction(h.id);
    if (!r.ok) { toast.error(r.error); return; }
    setChosen(r.data);
    setQty({});
    setPos(r.data.invoice.placeOfSupplyCode ?? "");
  }
  const picked = chosen ? chosen.lines.filter((l) => Number(qty[l.id]) > 0) : [];
  const estimate = picked.reduce((n, l) => n + (l.taxable * Number(qty[l.id])) / l.quantity, 0);

  function submit() {
    if (!chosen || picked.length === 0) { toast.error("Choose the quantity for at least one line"); return; }
    start(async () => {
      const r = await createNoteAction({
        noteType, customerId: chosen.invoice.customerId, originalInvoiceId: chosen.invoice.id, reason: reason as never, reasonText: reasonText || null,
        placeOfSupplyCode: pos || null, noteDate: date, lines: picked.map((l) => ({ invoiceLineId: l.id, quantity: Number(qty[l.id]) })),
      });
      if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
      toast.success(`${noteType === "CREDIT" ? "Credit" : "Debit"} note ${r.data.number} issued`);
      setOpen(false);
      router.push(`/credit-notes/${r.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> New credit / debit note</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New credit / debit note</DialogTitle>
          <DialogDescription>Lines mirror the invoice (same HSN, rate and tax) in proportion to the quantity you choose. A note never changes stock — receive returned goods through Sales Returns.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Type</Label>
              <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={noteType} onChange={(e) => setNoteType(e.target.value as "CREDIT" | "DEBIT")}><option value="CREDIT">Credit note</option><option value="DEBIT">Debit note</option></select></div>
            <div className="space-y-1"><Label>Note date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>Reason</Label>
              <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>
          {!chosen ? (
            <div className="space-y-2">
              <Label>Find the invoice (number or customer)</Label>
              <div className="flex gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="e.g. 216" /><Button variant="outline" onClick={search}>Search</Button></div>
              <ul className="max-h-48 divide-y overflow-auto rounded border">
                {hits.map((h) => <li key={h.id}><button className="flex w-full justify-between px-3 py-2 text-left hover:bg-accent" onClick={() => pick(h)}><span>{h.number} · {h.customer}</span><span className="text-muted-foreground">{h.date} · ₹{h.total.toLocaleString("en-IN")}</span></button></li>)}
                {hits.length === 0 ? <li className="px-3 py-2 text-muted-foreground">Search to list invoices.</li> : null}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded bg-muted/50 px-3 py-2"><span>Invoice <strong>{chosen.invoice.number}</strong> dated {chosen.invoice.date}</span><Button variant="ghost" size="sm" onClick={() => setChosen(null)}>Change</Button></div>
              {!chosen.invoice.placeOfSupplyCode ? (
                <div className="space-y-1"><Label>Place of supply (the invoice has none recorded)</Label>
                  <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={pos} onChange={(e) => setPos(e.target.value)}><option value="">Choose…</option>{states.map((s) => <option key={s.code} value={s.code}>{s.code}-{s.name}</option>)}</select></div>
              ) : null}
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr><th className="text-left">Item</th><th className="text-right">Invoiced</th><th className="text-right">Can still credit</th><th className="w-24 text-right">Quantity</th></tr></thead>
                <tbody>
                  {chosen.lines.map((l) => (
                    <tr key={l.id} className="border-t"><td className="py-1">{l.description}<span className="block text-muted-foreground">HSN {l.hsn ?? "—"} · {l.rate}%</span></td><td className="text-right">{l.quantity}</td><td className="text-right">{noteType === "CREDIT" ? l.remaining : "—"}</td>
                      <td className="text-right"><Input className="h-7 text-right" inputMode="numeric" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/\D/g, "") })} /></td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">Taxable value of this note ≈ ₹{estimate.toLocaleString("en-IN", { maximumFractionDigits: 2 })} (tax is added in the invoice's proportion).</p>
              <div className="space-y-1"><Label>Notes (optional)</Label><Input value={reasonText} onChange={(e) => setReasonText(e.target.value)} /></div>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} loading={pending} disabled={pending || !chosen}>Issue note</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
