/**
 * Trash retention rules for firms.
 *
 * Pure date/number helpers — no Prisma, no `server-only`, so both server
 * components and client dialogs can import this safely. The database work
 * lives in `./firm-trash.server.ts`.
 */

/** Days a trashed firm stays recoverable before it is purged for good. */
export const TRASH_RETENTION_DAYS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant a trashed firm stops being recoverable. */
export function trashRetentionEnd(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS);
}

/** Whole days left to restore a trashed firm; 0 once retention has elapsed. */
export function trashDaysLeft(deletedAt: Date, now: Date = new Date()): number {
  const remaining = trashRetentionEnd(deletedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}

/** True when a trashed firm is past its retention window and due a purge. */
export function trashRetentionElapsed(deletedAt: Date, now: Date = new Date()): boolean {
  return trashRetentionEnd(deletedAt).getTime() <= now.getTime();
}
