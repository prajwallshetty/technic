"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCustomerAction } from "@/app/(app)/customers/actions";
import { STATES } from "@/app/(app)/customers/add-button";
import { CUSTOMER_TYPE_LABELS } from "@/lib/workflow";

export interface PosCustomer {
  id: string;
  code: string;
  name: string;
  phone: string;
  gstin: string | null;
  state: string | null;
}

type CustomerType = "RETAIL" | "BUSINESS" | "DEALER" | "CORPORATE" | "OTHER";

interface FormState {
  name: string;
  phone: string;
  company: string;
  email: string;
  gstin: string;
  pan: string;
  type: CustomerType;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
}

const emptyForm: FormState = {
  name: "",
  phone: "",
  company: "",
  email: "",
  gstin: "",
  pan: "",
  type: "RETAIL",
  addressLine: "",
  city: "",
  state: "Karnataka",
  pincode: "",
};

/**
 * "Add customer" opened straight from the POS customer search, so a walk-in
 * who is not in the system yet never holds up the counter. It writes through
 * the same `createCustomerAction` as the Customers page — one code path, one
 * set of validation rules, one audit entry — so the record is identical
 * everywhere it is listed.
 */
export function AddPosCustomerDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whatever was typed into the customer search before opening. */
  initialName?: string;
  onCreated: (customer: PosCustomer) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>
            Added to this sale straight away and to every customer list in the app.
          </DialogDescription>
        </DialogHeader>
        {/* Remounts on each open so the search text seeds the fields again. */}
        {open ? (
          <CustomerForm
            initialName={initialName}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomerForm({
  initialName,
  onClose,
  onCreated,
}: {
  initialName?: string;
  onClose: () => void;
  onCreated: (customer: PosCustomer) => void;
}) {
  const [form, setForm] = useState<FormState>(() => {
    // A phone number typed into the search is a phone, not a name.
    const seed = (initialName ?? "").trim();
    const seedIsPhone = /^\d{6,}$/.test(seed);
    return { ...emptyForm, name: seedIsPhone ? "" : seed, phone: seedIsPhone ? seed : "" };
  });
  const [pending, startTransition] = useTransition();

  const set =
    (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = () => {
    startTransition(async () => {
      const result = await createCustomerAction({
        name: form.name,
        phone: form.phone,
        company: form.company || null,
        email: form.email || null,
        gstin: form.gstin || null,
        pan: form.pan || null,
        type: form.type,
        addressLine: form.addressLine || null,
        city: form.city || null,
        state: form.state,
        pincode: form.pincode || null,
      });

      if (result.ok) {
        toast.success(`Customer ${result.data.code} added`);
        onCreated(result.data);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pos-cus-name">Name *</Label>
          <Input
            id="pos-cus-name"
            value={form.name}
            onChange={set("name")}
            placeholder="Walk-in customer"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-phone">Phone *</Label>
          <Input
            id="pos-cus-phone"
            className="numeric"
            value={form.phone}
            onChange={set("phone")}
            placeholder="98765 43210"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-company">Company / business</Label>
          <Input id="pos-cus-company" value={form.company} onChange={set("company")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-email">Email</Label>
          <Input
            id="pos-cus-email"
            type="email"
            value={form.email}
            onChange={set("email")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-type">Customer type</Label>
          <Select
            value={form.type}
            onValueChange={(value) => setForm((c) => ({ ...c, type: value as CustomerType }))}
          >
            <SelectTrigger id="pos-cus-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-gstin">GSTIN (optional)</Label>
          <Input
            id="pos-cus-gstin"
            className="font-mono uppercase"
            value={form.gstin}
            onChange={set("gstin")}
            placeholder="29ABCDE1234F1Z5"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-pan">PAN (optional)</Label>
          <Input
            id="pos-cus-pan"
            className="font-mono uppercase"
            value={form.pan}
            onChange={set("pan")}
            placeholder="ABCDE1234F"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pos-cus-address">Address</Label>
          <Input
            id="pos-cus-address"
            value={form.addressLine}
            onChange={set("addressLine")}
            placeholder="42, Electronics City Phase 1"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-city">City</Label>
          <Input id="pos-cus-city" value={form.city} onChange={set("city")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-state">State (place of supply)</Label>
          <Select
            value={form.state}
            onValueChange={(value) => setForm((c) => ({ ...c, state: value }))}
          >
            <SelectTrigger id="pos-cus-state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-cus-pincode">Pincode</Label>
          <Input
            id="pos-cus-pincode"
            className="numeric"
            value={form.pincode}
            onChange={set("pincode")}
            placeholder="560100"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={pending || !form.name.trim() || !form.phone.trim()}
        >
          <UserPlus />
          {pending ? "Adding..." : "Add customer"}
        </Button>
      </DialogFooter>
    </>
  );
}
