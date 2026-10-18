"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { pumpBatchAction } from "../actions";

interface Progress {
  status: string;
  total: number;
  pending: number;
  done: number;
  counts: Partial<Record<string, number>>;
}

const LABELS: Array<[string, string]> = [
  ["READY", "ready"],
  ["NEEDS_REVIEW", "need review"],
  ["DUPLICATE", "duplicates"],
  ["FAILED", "failed"],
  ["APPROVED", "approved"],
  ["POSTED", "drafted"],
  ["REJECTED", "rejected"],
];

/**
 * Shows extraction progress and keeps the queue moving while the page is
 * open: each poll processes a few documents server-side, then refreshes the
 * table.
 */
export function BatchProgress({ batchId, initial }: { batchId: string; initial: Progress }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (initial.pending === 0) return;
    let cancelled = false;
    async function tick() {
      if (running.current || cancelled) return;
      running.current = true;
      const result = await pumpBatchAction(batchId);
      running.current = false;
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setProgress(result.data);
      router.refresh();
      if (result.data.pending > 0) setTimeout(tick, 1500);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [batchId, initial.pending, router]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 100;
  return (
    <div className="space-y-2 rounded-lg border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {progress.pending > 0 ? `Extracting… ${progress.done} of ${progress.total}` : `Extraction finished — ${progress.total} document(s)`}
        </span>
        <span className="text-muted-foreground">
          {LABELS.filter(([key]) => progress.counts[key])
            .map(([key, label]) => `${progress.counts[key]} ${label}`)
            .join(" · ")}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
