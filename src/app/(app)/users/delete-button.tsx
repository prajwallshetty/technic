"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
import { deleteUserAction } from "./actions";

interface DeleteUserButtonProps {
  userId: string;
  userName: string;
  userEmail: string;
  isSelf?: boolean;
  isPlatformAdmin?: boolean;
}

export function DeleteUserButton({
  userId,
  userName,
  userEmail,
  isSelf,
  isPlatformAdmin,
}: DeleteUserButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const disabled = Boolean(isSelf || isPlatformAdmin);
  const disabledReason = isSelf
    ? "You cannot delete your own account"
    : isPlatformAdmin
    ? "Platform admin accounts cannot be deleted"
    : undefined;

  const handleDelete = async () => {
    setPending(true);
    try {
      const result = await deleteUserAction({ id: userId });
      if (result.ok) {
        toast.success(`User ${userName} deleted successfully`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  if (disabled) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        className="h-8 w-8 p-0 opacity-40 cursor-not-allowed"
        title={disabledReason}
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span className="sr-only">{disabledReason}</span>
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive border-border hover:border-destructive/40"
          title="Delete user"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only">Delete user</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            Delete User · {userName}
          </DialogTitle>
          <DialogDescription className="space-y-2 text-sm pt-1">
            <p>
              Are you sure you want to permanently delete user <strong>{userName}</strong> ({userEmail})?
            </p>
            <p className="text-muted-foreground text-xs">
              This action cannot be undone. Historical documents (invoices, receipts, orders) created by this user will be preserved for compliance.
            </p>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
