"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Building2 } from "lucide-react";
import { toast } from "sonner";
import type { BranchType } from "@/generated/prisma/enums";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBranchAction } from "./actions";

export function CreateBranchButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    type: "BRANCH" as BranchType,
    gstin: "",
    addressLine: "",
    city: "",
    state: "",
    stateCode: "",
    pincode: "",
    phone: "",
    email: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);

    try {
      const result = await createBranchAction(formData);
      if (result.ok) {
        toast.success(`Branch ${formData.code.toUpperCase()} created successfully`);
        setOpen(false);
        setFormData({
          code: "",
          name: "",
          type: "BRANCH",
          gstin: "",
          addressLine: "",
          city: "",
          state: "",
          stateCode: "",
          pincode: "",
          phone: "",
          email: "",
        });
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="h-4 w-4" />
          <span>Create Branch</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <span>Create New Branch / Showroom</span>
            </DialogTitle>
            <DialogDescription>
              Add a physical or operational branch location to your firm.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch-code">Branch Code *</Label>
              <Input
                id="branch-code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                placeholder="SH01"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch-type">Branch Type *</Label>
              <select
                id="branch-type"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as BranchType })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="BRANCH">Branch / Showroom</option>
                <option value="HEAD_OFFICE">Head Office</option>
                <option value="WAREHOUSE">Warehouse</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="branch-name">Branch Name *</Label>
            <Input
              id="branch-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="MG Road Showroom"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch-gstin">GSTIN (if distinct)</Label>
              <Input
                id="branch-gstin"
                value={formData.gstin}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                placeholder="29AAKCT1234F1ZP"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-phone">Phone</Label>
              <Input
                id="branch-phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="08049001201"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="branch-address">Address</Label>
            <Input
              id="branch-address"
              value={formData.addressLine}
              onChange={(e) => setFormData({ ...formData, addressLine: e.target.value })}
              placeholder="12, MG Road Commercial Complex"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch-city">City</Label>
              <Input
                id="branch-city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Bengaluru"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-state">State</Label>
              <Input
                id="branch-state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="Karnataka"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-pincode">Pincode</Label>
              <Input
                id="branch-pincode"
                value={formData.pincode}
                onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                placeholder="560001"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create Branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
