"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserAction } from "./actions";

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "SALES_STAFF", label: "Sales Staff" },
  { value: "PURCHASE_STAFF", label: "Purchase Staff" },
  { value: "INVENTORY_MANAGER", label: "Inventory Manager" },
  { value: "VIEWER", label: "Viewer" },
];

const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "INACTIVE", label: "Inactive" },
];

interface EditUserData {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string | null;
  status: "ACTIVE" | "SUSPENDED" | "INACTIVE";
  isPlatformAdmin?: boolean;
  isSelf?: boolean;
}

interface EditUserButtonProps {
  user: EditUserData;
  branches: { id: string; name: string }[];
}

export function EditUserButton({ user, branches }: EditUserButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    accessCode: "",
    role: user.role,
    branchId: user.branchId ?? branches[0]?.id ?? "",
    status: user.status,
  });

  // Reset form when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setForm({
        name: user.name,
        email: user.email,
        accessCode: "",
        role: user.role,
        branchId: user.branchId ?? branches[0]?.id ?? "",
        status: user.status,
      });
    }
  };

  const submit = () => {
    if (form.accessCode && form.accessCode.length !== 6) {
      toast.error("Login code must be exactly 6 digits (or leave blank to keep unchanged)");
      return;
    }

    startTransition(async () => {
      const result = await updateUserAction({
        id: user.id,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        accessCode: form.accessCode ? form.accessCode : undefined,
        role: form.role,
        branchId: form.branchId,
        status: form.status,
      });

      if (result.ok) {
        toast.success(`User ${result.data.name} updated successfully`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Edit user">
          <Pencil className="h-3.5 w-3.5" />
          <span className="sr-only">Edit user</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User · {user.name}</DialogTitle>
          <DialogDescription>
            Update user information, assign branches, or reset their 6-digit login access code.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`edit-user-name-${user.id}`}>Name *</Label>
            <Input
              id={`edit-user-name-${user.id}`}
              value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`edit-user-email-${user.id}`}>Email *</Label>
            <Input
              id={`edit-user-email-${user.id}`}
              type="email"
              value={form.email}
              onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`edit-user-code-${user.id}`}>
              New login code (6 digits)
            </Label>
            <Input
              id={`edit-user-code-${user.id}`}
              className="numeric"
              inputMode="numeric"
              maxLength={6}
              placeholder="Leave blank to keep current"
              value={form.accessCode}
              onChange={(e) =>
                setForm((c) => ({ ...c, accessCode: e.target.value.replace(/\D/g, "") }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            {user.isPlatformAdmin ? (
              <Input value="Platform Admin" disabled />
            ) : (
              <Select
                value={form.role}
                onValueChange={(value) => setForm((c) => ({ ...c, role: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select
              value={form.branchId}
              onValueChange={(value) => setForm((c) => ({ ...c, branchId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(value: "ACTIVE" | "SUSPENDED" | "INACTIVE") =>
                setForm((c) => ({ ...c, status: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              pending ||
              !form.name.trim() ||
              !form.email.trim() ||
              !form.branchId ||
              (form.accessCode.length > 0 && form.accessCode.length !== 6)
            }
          >
            {pending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
