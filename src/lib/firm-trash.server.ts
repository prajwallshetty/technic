import "server-only";

import { prisma } from "@/lib/prisma";
import { TRASH_RETENTION_DAYS, trashRetentionElapsed } from "@/lib/firm-trash";

/**
 * Hard-deletes every firm whose 100-day trash window has elapsed.
 *
 * Best effort: a firm still referenced through a restrictive foreign key
 * (branches, customers, invoices…) cannot be dropped by the database. Such a
 * firm is marked INACTIVE and left with its `deletedAt` set, which hides it
 * from every query exactly like a purged one — the row survives only so the
 * referential data stays consistent, and the purge is retried on the next run.
 *
 * Safe to call on every page load: it is a no-op when nothing is due.
 */
export async function purgeExpiredFirms(): Promise<{ purged: number; retired: number }> {
  const trashed = await prisma.firm.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, code: true, name: true, status: true, deletedAt: true },
  });

  const due = trashed.filter((firm) => firm.deletedAt && trashRetentionElapsed(firm.deletedAt));
  if (due.length === 0) return { purged: 0, retired: 0 };

  let purged = 0;
  let retired = 0;

  for (const firm of due) {
    try {
      await prisma.firm.delete({ where: { id: firm.id } });
      purged += 1;
    } catch (error) {
      // Referentially blocked (a restrictive foreign key still points at the
      // firm) — tombstone it instead: mark it inactive and release its code so
      // a new firm can be created with it. The row stays hidden behind
      // `deletedAt` either way, and the purge is retried on the next run.
      try {
        await prisma.firm.update({
          where: { id: firm.id },
          data: { status: "INACTIVE", code: `PURGED_${firm.code}` },
        });
      } catch {
        // Already gone or locked; the stale row stays hidden either way.
      }
      retired += 1;
      console.error(
        `[trash] firm ${firm.code} is past its ${TRASH_RETENTION_DAYS}-day retention but could not be deleted; kept as a tombstone`,
        error,
      );
    }
  }

  return { purged, retired };
}
