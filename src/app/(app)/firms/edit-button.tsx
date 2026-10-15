"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Edit } from "lucide-react";
import { toast } from "sonner";

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
import { editFirmAction } from "./actions";

interface EditFirmButtonProps {
  firmId: string;
  firmName: string;
}

export function EditFirmButton({ firmId, firmName }: EditFirmButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    legalName: "",
    displayName: "",
    gstin: "",
    pan: "",
    addressLine: "",
    city: "",
    state: "",
    stateCode: "",
    pincode: "",
    phone: "",
    email: "",
    website: "",
    logo: "",
    invoicePrefix: "INV",
    quotationPrefix: "QT",
    purchasePrefix: "PO",
    financialYear: "26-27",
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
  });

  const handleOpenChange = async (newOpen: boolean) => {
    if (newOpen && !open) {
      setPending(true);
      try {
        const response = await fetch(`/api/firms/${firmId}`);
        if (response.ok) {
          const firm = await response.json();
          setFormData({
            name: firm.name || "",
            legalName: firm.legalName || "",
            displayName: firm.displayName || "",
            gstin: firm.gstin || "",
            pan: firm.pan || "",
            addressLine: firm.addressLine || "",
            city: firm.city || "",
            state: firm.state || "",
            stateCode: firm.stateCode || "",
            pincode: firm.pincode || "",
            phone: firm.phone || "",
            email: firm.email || "",
            website: firm.website || "",
            logo: firm.logoUrl || "",
            invoicePrefix: firm.invoicePrefix || "INV",
            quotationPrefix: firm.quotationPrefix || "QT",
            purchasePrefix: firm.purchasePrefix || "PO",
            financialYear: firm.financialYear || "26-27",
            status: firm.status || "ACTIVE",
          });
        } else {
          toast.error("Failed to load firm details");
        }
      } finally {
        setPending(false);
      }
    }
    setOpen(newOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);

    try {
      const result = await editFirmAction({ firmId, ...formData });
      if (result.ok) {
        toast.success("Firm details updated successfully");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Edit className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Firm · {firmName}</DialogTitle>
          <DialogDescription>Update firm details, contact info, and billing settings.</DialogDescription>
        </DialogHeader>
        <Link href={`/firms/${firmId}/settings`} className="text-sm text-primary underline-offset-4 hover:underline">
          Advanced firm settings &amp; administration
        </Link>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Legal Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Technic Technologies Pvt Ltd"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="Technic Technologies"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input
                id="gstin"
                value={formData.gstin}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                placeholder="29AAKCT1234F1ZP"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pan">PAN</Label>
              <Input
                id="pan"
                value={formData.pan}
                onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                placeholder="AAKCT1234F"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="08049001200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="sales@technic.example"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="www.technic.example"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logo">Logo URL</Label>
              <Input
                id="logo"
                value={formData.logo}
                onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
                placeholder="https://example.com/logo.png"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as "ACTIVE" | "INACTIVE" })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="addressLine">Address</Label>
            <Input
              id="addressLine"
              value={formData.addressLine}
              onChange={(e) => setFormData({ ...formData, addressLine: e.target.value })}
              placeholder="42, Electronics City Phase 1, Hosur Road"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Bengaluru"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="Karnataka"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stateCode">State Code</Label>
              <Input
                id="stateCode"
                value={formData.stateCode}
                onChange={(e) => setFormData({ ...formData, stateCode: e.target.value })}
                placeholder="29"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pincode">Pincode</Label>
              <Input
                id="pincode"
                value={formData.pincode}
                onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                placeholder="560100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="financialYear">Financial Year</Label>
              <Input
                id="financialYear"
                value={formData.financialYear}
                onChange={(e) => setFormData({ ...formData, financialYear: e.target.value })}
                placeholder="26-27"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoicePrefix">Invoice Prefix</Label>
              <Input
                id="invoicePrefix"
                value={formData.invoicePrefix}
                onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value })}
                placeholder="INV"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quotationPrefix">Quotation Prefix</Label>
              <Input
                id="quotationPrefix"
                value={formData.quotationPrefix}
                onChange={(e) => setFormData({ ...formData, quotationPrefix: e.target.value })}
                placeholder="QT"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchasePrefix">Purchase Prefix</Label>
              <Input
                id="purchasePrefix"
                value={formData.purchasePrefix}
                onChange={(e) => setFormData({ ...formData, purchasePrefix: e.target.value })}
                placeholder="PO"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
