"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
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
import { purgeFirmAction } from "./actions";

interface PurgeFirmButtonProps {
  firmId: string;
  firmCode: string;
  firmName: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "outline" | "destructive" | "ghost";
}

export function PurgeFirmButton({
  firmId,
  firmCode,
  firmName,
  size = "sm",
  variant = "destructive",
}: PurgeFirmButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");

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
      const result = await purgeFirmAction({ firmId, confirmation: typed.trim() });
      if (result.ok) {
        toast.success(`${firmName} has been permanently purged`);
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
        <Button size={size} variant={variant} className="gap-1.5">
          <Trash2 className="h-4 w-4" />
          <span>Permanently Delete</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Permanently delete {firmName}?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-foreground">
                  This action CANNOT be undone.
                </p>
                <p>
                  You are about to permanently purge firm <strong>{firmName}</strong> ({firmCode}) and all of its associated system records.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="purge-confirm">
              Type <span className="font-mono font-semibold">{firmCode}</span> to confirm permanent deletion
            </Label>
            <Input
              id="purge-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={firmCode}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-invalid={typed.length > 0 && !confirmed}
            />
            {typed.length > 0 && !confirmed ? (
              <p className="text-xs text-destructive">Code does not match.</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!confirmed || pending}
              variant="destructive"
            >
              {pending ? "Purging..." : "Permanently Delete Firm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
