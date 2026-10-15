"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, CheckCircle, AlertTriangle } from "lucide-react";
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
import { toggleFirmStatusAction } from "./actions";

interface ToggleFirmStatusButtonProps {
  firmId: string;
  firmName: string;
  currentStatus: "ACTIVE" | "INACTIVE";
}

export function ToggleFirmStatusButton({
  firmId,
  firmName,
  currentStatus,
}: ToggleFirmStatusButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const isDeactivating = currentStatus === "ACTIVE";
  const targetStatus = isDeactivating ? "INACTIVE" : "ACTIVE";

  const handleToggle = async () => {
    setPending(true);
    try {
      const result = await toggleFirmStatusAction({ firmId, status: targetStatus });
      if (result.ok) {
        toast.success(
          isDeactivating
            ? `${firmName} deactivated. New transactions are blocked, historical data preserved.`
            : `${firmName} reactivated and ready for billing.`
        );
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
          variant={isDeactivating ? "outline" : "default"}
          className={isDeactivating ? "text-warning hover:text-warning" : "bg-success text-white hover:bg-success/90"}
        >
          {isDeactivating ? <Power className="h-4 w-4 mr-1.5" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
          <span>{isDeactivating ? "Deactivate Firm" : "Reactivate Firm"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className={isDeactivating ? "text-warning" : "text-success"} />
            <span>{isDeactivating ? `Deactivate ${firmName}?` : `Reactivate ${firmName}?`}</span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm pt-2">
              {isDeactivating ? (
                <>
                  <p>
                    Deactivating <strong>{firmName}</strong> blocks users from creating new invoices, orders, or transactions in this firm.
                  </p>
                  <p className="text-muted-foreground">
                    All historical billing data, ledgers, reports, and audit logs remain 100% intact. You can reactivate this firm at any time.
                  </p>
                </>
              ) : (
                <p>
                  Reactivating <strong>{firmName}</strong> puts it back into active service, allowing users to select it and resume billing.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleToggle}
            disabled={pending}
            className={isDeactivating ? "bg-warning text-white hover:bg-warning/90" : "bg-success text-white hover:bg-success/90"}
          >
            {pending
              ? isDeactivating
                ? "Deactivating..."
                : "Reactivating..."
              : isDeactivating
              ? "Confirm Deactivation"
              : "Confirm Reactivation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
