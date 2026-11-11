"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cancelNoteAction } from "../actions";

export function CancelNoteButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt("Why is this note being cancelled? (kept in the audit log)");
        if (!reason) return;
        start(async () => {
          const r = await cancelNoteAction(noteId, reason);
          if (!r.ok) toast.error(r.error);
          else toast.success("Note cancelled");
          router.refresh();
        });
      }}
    >
      Cancel note
    </Button>
  );
}
