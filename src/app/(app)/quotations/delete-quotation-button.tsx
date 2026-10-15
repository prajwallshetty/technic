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
import { deleteQuotationAction } from "./actions";

interface DeleteQuotationButtonProps {
  quotationId: string;
  quotationNumber?: string;
  variant?: "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon";
  redirectOnDelete?: boolean;
  className?: string;
}

export function DeleteQuotationButton({
  quotationId,
  quotationNumber,
  variant = "outline",
  size = "default",
  redirectOnDelete = false,
  className,
}: DeleteQuotationButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteQuotationAction({ quotationId });
      if (result.ok) {
        toast.success(
          quotationNumber
            ? `Quotation ${quotationNumber} deleted`
            : "Quotation deleted",
        );
        setOpen(false);
        if (redirectOnDelete) {
          router.push("/quotations");
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
          title="Delete quotation"
        >
          <Trash2 className="h-4 w-4" />
          {size !== "icon" && <span className="ml-1.5">Delete</span>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete Quotation {quotationNumber ? `(${quotationNumber})` : ""}?
          </DialogTitle>
          <DialogDescription>
            This will permanently delete this quotation and its line items. This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Keep quotation
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
