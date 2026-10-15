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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TRASH_RETENTION_DAYS } from "@/lib/firm-trash";
import { trashFirmAction } from "../../actions";

interface TrashFirmButtonProps {
  firmId: string;
  firmCode: string;
  firmName: string;
  recordCount: number;
}

export function TrashFirmButton({ firmId, firmCode, firmName, recordCount }: TrashFirmButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");

  // The exact firm code must be typed before the destructive action unlocks.
  const confirmed = typed.trim().toUpperCase() === firmCode.toUpperCase();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setTyped("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmed || pending) return;

    setPending(true);
    try {
      const result = await trashFirmAction({ firmId, confirmation: typed.trim() });
      if (result.ok) {
        toast.success(`${firmName} moved to the trash`);
        router.push("/firms");
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
        <Button variant="outline" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
          Move firm to trash
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Move {firmName} to the trash?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Everyone signed in to this firm loses access immediately and it disappears from the app. Its
                  data is kept for <strong>{TRASH_RETENTION_DAYS} days</strong> and can be restored from the
                  Firms page at any point in that window — after that it is deleted permanently.
                </p>
                {recordCount > 0 ? (
                  <p className="text-destructive">
                    This firm holds {recordCount} records (users, branches, products, customers, suppliers,
                    invoices). Nothing is deleted now, but it stays unreachable for as long as it is trashed.
                  </p>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="trash-confirm">
              Type <span className="font-mono font-semibold">{firmCode}</span> to confirm
            </Label>
            <Input
              id="trash-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={firmCode}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-invalid={typed.length > 0 && !confirmed}
            />
            {typed.length > 0 && !confirmed ? (
              <p className="text-xs text-destructive">That does not match the firm code.</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!confirmed || pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Moving..." : "Move to trash"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
