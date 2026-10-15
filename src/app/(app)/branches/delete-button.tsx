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
import { deleteBranchAction } from "./actions";

interface DeleteBranchButtonProps {
  branchId: string;
  branchName: string;
  branchCode: string;
}

export function DeleteBranchButton({
  branchId,
  branchName,
  branchCode,
}: DeleteBranchButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handleDelete = async () => {
    setPending(true);
    try {
      const result = await deleteBranchAction({ branchId });
      if (result.ok) {
        toast.success(`Branch ${branchName} (${branchCode}) deleted successfully`);
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
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive border-border hover:border-destructive/40"
          title="Delete branch"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            Delete Branch · {branchName}
          </DialogTitle>
          <DialogDescription className="space-y-2 text-sm pt-1">
            <p>
              Are you sure you want to remove <strong>{branchName}</strong> (Code:{" "}
              <span className="font-mono font-semibold">{branchCode}</span>)?
            </p>
            <p className="text-muted-foreground text-xs">
              Staff members currently assigned to this branch will automatically be reassigned to the main Head Office.
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
            {pending ? "Deleting..." : "Delete Branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
