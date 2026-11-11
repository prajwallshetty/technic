"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fixInvoiceGstAction } from "../../reports/gstr1/actions";

const SUPPLY_TYPES: [string, string][] = [
  ["REGULAR", "Regular (taxable)"], ["SEZ_WITH_PAYMENT", "SEZ — with payment of tax"], ["SEZ_WITHOUT_PAYMENT", "SEZ — without payment of tax"], ["DEEMED_EXPORT", "Deemed export"],
  ["EXPORT_WITH_PAYMENT", "Export — with payment of tax"], ["EXPORT_WITHOUT_PAYMENT", "Export — without payment (LUT)"],
];

interface Initial {
  placeOfSupplyCode: string;
  supplyType: string;
  reverseCharge: boolean;
  ecommerceGstin: string;
  billToGstin: string;
  portCode: string;
  shippingBillNumber: string;
  shippingBillDate: string;
}

/**
 * GST classification used by the GSTR-1: place of supply, supply type, reverse
 * charge, e-commerce operator and export details. Amounts are never changed here.
 */
export function GstDetailsButton({ invoiceId, initial, states }: { invoiceId: string; initial: Initial; states: { code: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  const [pending, start] = useTransition();
  const isExport = f.supplyType.startsWith("EXPORT");
  const set = (k: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((c) => ({ ...c, [k]: e.target.value }));

  function submit() {
    start(async () => {
      const r = await fixInvoiceGstAction(invoiceId, {
        placeOfSupplyCode: f.placeOfSupplyCode || null, supplyType: f.supplyType as never, reverseCharge: f.reverseCharge, ecommerceGstin: f.ecommerceGstin || null,
        billToGstin: f.billToGstin || null, ...(isExport ? { portCode: f.portCode || null, shippingBillNumber: f.shippingBillNumber || null, shippingBillDate: f.shippingBillDate || null } : {}),
      });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success("GST details saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Landmark className="size-4" /> GST details</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>GST details for the return</DialogTitle>
          <DialogDescription>These classify the invoice in GSTR-1. They do not change any amount, quantity or rate.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1"><Label>Place of supply</Label>
            <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={f.placeOfSupplyCode} onChange={set("placeOfSupplyCode")}>
              <option value="">Not set</option>{states.map((s) => <option key={s.code} value={s.code}>{s.code}-{s.name}</option>)}<option value="96">96-Foreign Country (exports)</option>
            </select></div>
          <div className="space-y-1"><Label>Supply type</Label>
            <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={f.supplyType} onChange={set("supplyType")}>{SUPPLY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="space-y-1"><Label>Recipient GSTIN</Label><Input className="font-mono" value={f.billToGstin} onChange={(e) => setF((c) => ({ ...c, billToGstin: e.target.value.toUpperCase() }))} /></div>
          <div className="space-y-1"><Label>E-commerce operator GSTIN</Label><Input className="font-mono" value={f.ecommerceGstin} onChange={(e) => setF((c) => ({ ...c, ecommerceGstin: e.target.value.toUpperCase() }))} placeholder="only if sold via an operator" /></div>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={f.reverseCharge} onChange={(e) => setF((c) => ({ ...c, reverseCharge: e.target.checked }))} /> Tax payable on reverse charge by the recipient</label>
          {isExport ? (
            <>
              <div className="space-y-1"><Label>Port code</Label><Input value={f.portCode} onChange={set("portCode")} /></div>
              <div className="space-y-1"><Label>Shipping bill number</Label><Input value={f.shippingBillNumber} onChange={set("shippingBillNumber")} /></div>
              <div className="space-y-1"><Label>Shipping bill date</Label><Input type="date" value={f.shippingBillDate} onChange={set("shippingBillDate")} /></div>
            </>
          ) : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} loading={pending} disabled={pending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
