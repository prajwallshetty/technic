"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createFromReturnAction } from "../../credit-notes/actions";

/** Explicit: an approved return only becomes a GST credit note when someone chooses to issue one. */
export function CreateCreditNoteButton({ salesReturnId }: { salesReturnId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Issue a GST credit note for this return? It will appear in the GSTR-1 and reduce the customer's balance.")) return;
        start(async () => {
          const r = await createFromReturnAction(salesReturnId);
          if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
          toast.success(`Credit note ${r.data.number} issued`);
          router.push(`/credit-notes/${r.data.id}`);
        });
      }}
    >
      Create credit note
    </Button>
  );
}
