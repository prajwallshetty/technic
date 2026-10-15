"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { switchBranchAction } from "./actions";

interface SetWorkBranchButtonProps {
  branchId: string;
  branchName: string;
  isCurrent: boolean;
  disabled?: boolean;
}

export function SetWorkBranchButton({
  branchId,
  branchName,
  isCurrent,
  disabled = false,
}: SetWorkBranchButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (isCurrent) {
    return (
      <Button size="sm" variant="secondary" disabled className="gap-1 bg-success/15 text-success font-medium">
        <MapPin className="h-3.5 w-3.5" />
        Current Location
      </Button>
    );
  }

  const handleSwitch = async () => {
    setPending(true);
    try {
      const result = await switchBranchAction({ branchId });
      if (result.ok) {
        toast.success(`Active work location set to ${branchName}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleSwitch}
      disabled={pending || disabled}
      className="gap-1"
    >
      <MapPin className="h-3.5 w-3.5" />
      {pending ? "Switching..." : "Set as Work Location"}
    </Button>
  );
}
