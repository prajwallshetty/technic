"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit } from "lucide-react";
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
import { editBranchAction } from "./actions";

interface BranchData {
  id: string;
  code: string;
  name: string;
  type: BranchType;
  gstin: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

interface EditBranchButtonProps {
  branch: BranchData;
}

export function EditBranchButton({ branch }: EditBranchButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formData, setFormData] = useState({
    name: branch.name,
    type: branch.type,
    gstin: branch.gstin || "",
    addressLine: branch.addressLine || "",
    city: branch.city || "",
    state: branch.state || "",
    stateCode: branch.stateCode || "",
    pincode: branch.pincode || "",
    phone: branch.phone || "",
    email: branch.email || "",
    isActive: branch.isActive,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);

    try {
      const result = await editBranchAction({
        branchId: branch.id,
        ...formData,
      });
      if (result.ok) {
        toast.success(`Branch ${branch.code} updated successfully`);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Edit className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit Branch · {branch.code}</DialogTitle>
            <DialogDescription>
              Update location details and operational status. Branch code ({branch.code}) cannot be changed.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-branch-name">Branch Name *</Label>
              <Input
                id="edit-branch-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-branch-type">Branch Type *</Label>
              <select
                id="edit-branch-type"
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-branch-gstin">GSTIN</Label>
              <Input
                id="edit-branch-gstin"
                value={formData.gstin}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-branch-phone">Phone</Label>
              <Input
                id="edit-branch-phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-branch-address">Address</Label>
            <Input
              id="edit-branch-address"
              value={formData.addressLine}
              onChange={(e) => setFormData({ ...formData, addressLine: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-branch-city">City</Label>
              <Input
                id="edit-branch-city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-branch-state">State</Label>
              <Input
                id="edit-branch-state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-branch-pincode">Pincode</Label>
              <Input
                id="edit-branch-pincode"
                value={formData.pincode}
                onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-branch-status">Operational Status</Label>
            <select
              id="edit-branch-status"
              value={formData.isActive ? "active" : "inactive"}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.value === "active" })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <DialogFooter>
            <div className="flex w-full items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={async () => {
                  if (
                    !confirm(
                      `Are you sure you want to delete branch "${branch.name}" (${branch.code})? Any assigned users will be moved to the main Head Office.`
                    )
                  ) {
                    return;
                  }
                  setPending(true);
                  try {
                    const { deleteBranchAction } = await import("./actions");
                    const res = await deleteBranchAction({ branchId: branch.id });
                    if (res.ok) {
                      toast.success(`Branch ${branch.name} deleted`);
                      setOpen(false);
                      router.refresh();
                    } else {
                      toast.error(res.error);
                    }
                  } finally {
                    setPending(false);
                  }
                }}
                disabled={pending}
              >
                Delete Branch
              </Button>

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
