"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MapPin, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchBranchAction } from "@/app/(app)/branches/actions";

interface BranchOption {
  id: string;
  name: string;
  code: string;
}

interface BranchSwitcherProps {
  currentBranchName: string | null;
}

export function BranchSwitcher({ currentBranchName }: BranchSwitcherProps) {
  const router = useRouter();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [canSeeAll, setCanSeeAll] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/branches")
      .then((res) => (res.ok ? res.json() : { branches: [], canSeeAllBranches: false }))
      .then((data) => {
        setBranches(data.branches ?? []);
        setCanSeeAll(Boolean(data.canSeeAllBranches));
      })
      .catch(() => {
        setBranches([]);
        setCanSeeAll(false);
      });
  }, []);

  const handleSelectBranch = async (branchId: string | null, targetName: string) => {
    if ((!branchId && !currentBranchName) || targetName === currentBranchName || pending) return;
    setPending(true);
    try {
      const result = await switchBranchAction({ branchId });
      if (result.ok) {
        toast.success(`Active work location set to ${targetName}`);
        router.refresh();
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  };

  const displayName = currentBranchName || (canSeeAll ? "All Branches" : "Main Branch");

  if (branches.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium text-foreground">{displayName}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted focus:outline-hidden disabled:opacity-60"
      >
        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="max-w-[130px] truncate">{displayName}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
          Switch Work Location
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {canSeeAll && (
          <>
            <DropdownMenuItem
              onClick={() => handleSelectBranch(null, "All Branches")}
              className="flex items-center justify-between py-2 text-xs cursor-pointer font-medium"
            >
              <div className="flex flex-col min-w-0">
                <span>All Branches (Consolidated)</span>
                <span className="text-[10px] text-muted-foreground font-normal">View all locations</span>
              </div>
              {!currentBranchName && <Check className="h-4 w-4 text-primary shrink-0 ml-2" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {branches.map((b) => {
          const isSelected = b.name === currentBranchName;
          return (
            <DropdownMenuItem
              key={b.id}
              onClick={() => handleSelectBranch(b.id, b.name)}
              className="flex items-center justify-between py-2 text-xs cursor-pointer"
            >
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">{b.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{b.code}</span>
              </div>
              {isSelected && <Check className="h-4 w-4 text-primary shrink-0 ml-2" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
