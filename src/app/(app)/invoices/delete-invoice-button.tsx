"use client";

import { useState, useTransition } from "react";
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
import { deleteInvoiceAction } from "./[id]/actions";

interface DeleteInvoiceButtonProps {
  invoiceId: string;
  invoiceNumber?: string;
  isCancelled?: boolean;
  variant?: "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon";
  redirectOnDelete?: boolean;
  className?: string;
}

export function DeleteInvoiceButton({
  invoiceId,
  invoiceNumber,
  isCancelled = false,
  variant = "outline",
  size = "default",
  redirectOnDelete = false,
  className,
}: DeleteInvoiceButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteInvoiceAction({ invoiceId });
      if (result.ok) {
        toast.success(
          invoiceNumber ? `Invoice ${invoiceNumber} deleted` : "Invoice deleted",
        );
        setOpen(false);
        if (redirectOnDelete) {
          router.push("/invoices");
        } else {
          router.refresh();
        }
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={
            className ??
            (variant === "outline"
              ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
              : variant === "ghost"
                ? "text-muted-foreground hover:text-destructive"
                : "")
          }
          title="Delete invoice"
        >
          <Trash2 className="h-4 w-4" />
          {size !== "icon" && <span className="ml-1.5">Delete</span>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete Invoice {invoiceNumber ? `(${invoiceNumber})` : ""}?
          </DialogTitle>
          <DialogDescription>
            {isCancelled
              ? "This will permanently delete this cancelled invoice and its associated records. This action cannot be undone."
              : "This will permanently delete this invoice, restore stock levels in inventory, release assigned serial numbers, and recalculate customer balance. This action cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Keep invoice
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
