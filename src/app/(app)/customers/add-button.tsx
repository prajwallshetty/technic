"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { createCustomerAction } from "./actions";

export const STATES = [
  "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu",
  "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export function AddCustomerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", gstin: "", city: "", state: "Karnataka" });
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = () => {
    startTransition(async () => {
      const result = await createCustomerAction({
        name: form.name,
        phone: form.phone,
        gstin: form.gstin || null,
        city: form.city || null,
        state: form.state,
      });
      if (result.ok) {
        toast.success(`Customer ${result.data.code} created`);
        setOpen(false);
        setForm({ name: "", phone: "", gstin: "", city: "", state: "Karnataka" });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus /> Add customer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New customer</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cus-name">Name *</Label>
            <Input id="cus-name" value={form.name} onChange={set("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cus-phone">Phone *</Label>
            <Input id="cus-phone" className="numeric" value={form.phone} onChange={set("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cus-gstin">GSTIN (optional)</Label>
            <Input id="cus-gstin" className="font-mono uppercase" value={form.gstin} onChange={set("gstin")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cus-city">City</Label>
            <Input id="cus-city" value={form.city} onChange={set("city")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cus-state">State (place of supply)</Label>
            <Select value={form.state} onValueChange={(value) => setForm((c) => ({ ...c, state: value }))}>
              <SelectTrigger id="cus-state"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((state) => (
                  <SelectItem key={state} value={state}>{state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !form.name.trim() || !form.phone.trim()}>
            {pending ? "Saving…" : "Create customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
