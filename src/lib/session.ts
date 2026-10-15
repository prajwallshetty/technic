import "server-only";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isGlobalRole, isPlatformRole, type PermissionCode } from "@/lib/rbac";
import type { AccessView } from "@/types/next-auth";
import type { TaxMode, UserRole } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  employeeCode: string | null;
  permissions: PermissionCode[];
  /** The firm this user's own account belongs to. Null only for PLATFORM_ADMIN. */
  firmId: string | null;
  firmName: string | null;
  /**
   * The firm actually being operated in for this request. Equal to firmId
   * for every ordinary firm user (fixed, never switchable). For
   * PLATFORM_ADMIN this is whichever firm they last "entered" via the Firms
   * module's switcher — null until they do.
   */
  activeFirmId: string | null;
  activeFirmName: string | null;
  /**
   * Which transaction stream this session may see: COMBINED (both tax
   * invoices and bills — the default, and the full view for the
   * Super Admin) or GST_ONLY (an internal GST-reconciliation view; only
   * GST transactions are visible). Enforced on every backend read path.
   */
  accessView: AccessView;
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "Your session has expired — please sign in again to continue (your data is safe)") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Resolves a usable work branch inside `firmId`. The preferred branch is kept
 * when it is active and belongs to the firm. Otherwise only global roles
 * (who may work in any branch of the firm) fall back to the firm's first
 * active branch — ordinary branch staff stay pinned to their own branch and
 * get an explicit "ask an administrator" error from requireWriteBranch.
 */
async function resolveWorkBranch(
  firmId: string,
  preferredBranchId: string | null,
  role: UserRole,
): Promise<{ id: string; name: string; code: string } | null> {
  if (preferredBranchId) {
    const preferred = await prisma.branch.findFirst({
      where: { id: preferredBranchId, firmId },
      select: { id: true, name: true, code: true, isActive: true },
    });
    if (preferred && (preferred.isActive || !isGlobalRole(role))) return preferred;
  }
  if (!isGlobalRole(role)) return null;
  return prisma.branch.findFirst({
    where: { firmId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, code: true },
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const ownFirmId = session.user.firmId ?? null;
  let activeFirmId = session.user.activeFirmId ?? null;
  let activeFirmName = session.user.activeFirmName ?? null;
  const watchedIds = [...new Set([ownFirmId, activeFirmId].filter(Boolean))] as string[];

  if (watchedIds.length > 0) {
    // JWT sessions are stateless, so a firm deactivated or moved to the trash
    // after a user's token was issued would otherwise keep working until the
    // token next refreshes. Re-verified on every request.
    const firms = await prisma.firm.findMany({
      where: { id: { in: watchedIds } },
      select: { id: true, name: true, status: true, deletedAt: true },
    });
    const byId = new Map(firms.map((firm) => [firm.id, firm]));

    const own = ownFirmId ? byId.get(ownFirmId) : undefined;
    if (ownFirmId && (!own || own.status !== "ACTIVE" || own.deletedAt)) return null;

    // The firm actually being operated in. A switchable user (platform admin /
    // admin) keeps their chosen firm in the token; if that firm has since been
    // trashed or deactivated we degrade to "no firm selected" (the Firms page
    // lets them pick again) instead of ejecting them from the app.
    const active = activeFirmId ? byId.get(activeFirmId) : undefined;
    if (activeFirmId && (!active || active.status !== "ACTIVE" || active.deletedAt)) {
      activeFirmId = null;
      activeFirmName = null;
    } else if (active) {
      activeFirmName = active.name ?? activeFirmName;
    }
  }

  // Self-heal the saved work location. The token's branch can point at a
  // branch of a different firm (after switching firms or a token refresh) or
  // at a deleted/deactivated branch; resolve a valid one for the active firm.
  let branchId = session.user.branchId;
  let branchName = session.user.branchName;
  let branchCode = session.user.branchCode;
  if (activeFirmId) {
    const resolved = await resolveWorkBranch(activeFirmId, branchId, session.user.role);
    if (resolved) {
      branchId = resolved.id;
      branchName = resolved.name;
      branchCode = resolved.code;
    }
  }

  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    image: session.user.image,
    role: session.user.role,
    branchId,
    branchName,
    branchCode,
    employeeCode: session.user.employeeCode,
    permissions: session.user.permissions ?? [],
    firmId: session.user.firmId ?? null,
    firmName: session.user.firmName ?? null,
    activeFirmId,
    activeFirmName,
    accessView: session.user.accessView === "GST_ONLY" ? "GST_ONLY" : "COMBINED",
  };
}

/** For pages: bounces to /login when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function hasPermission(
  user: Pick<SessionUser, "permissions">,
  permission: PermissionCode | PermissionCode[],
): boolean {
  const wanted = Array.isArray(permission) ? permission : [permission];
  return wanted.some((code) => user.permissions.includes(code));
}

export function hasAllPermissions(
  user: Pick<SessionUser, "permissions">,
  permissions: PermissionCode[],
): boolean {
  return permissions.every((code) => user.permissions.includes(code));
}

/** For pages: 403 page when the signed-in user lacks the permission. */
export async function requirePermission(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) redirect("/forbidden");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function authorize(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  if (!hasPermission(user, permission)) throw new AuthorizationError();
  return user;
}

/**
 * The Prisma `taxMode` filter implied by the session's view stream. In the
 * COMBINED view it is undefined (no filtering — both transaction kinds);
 * in the GST_ONLY view it restricts every tax-mode-aware query to GST
 * records. Reads it from the session — never from request data.
 */
export function taxModeWhere(
  user: Pick<SessionUser, "accessView">,
): { taxMode?: TaxMode } {
  return user.accessView === "GST_ONLY" ? { taxMode: "GST" as const } : {};
}

/**
 * The tenant boundary every operational query must filter by. Never reads
 * from a request body, query string, or client-supplied value — always the
 * server-resolved session.
 */
export function requireFirmId(user: SessionUser): string {
  if (!user.activeFirmId) {
    throw new AuthorizationError(
      isPlatformRole(user.role)
        ? "Select a firm from the Firms module before accessing operational data."
        : "Your account is not assigned to a firm.",
    );
  }
  return user.activeFirmId;
}

/** For pages: 403 page instead of throwing when no firm is active. */
export async function requirePermissionInFirm(
  permission: PermissionCode | PermissionCode[],
): Promise<SessionUser & { activeFirmId: string }> {
  const user = await requirePermission(permission);
  if (!user.activeFirmId) redirect("/firms");
  return user as SessionUser & { activeFirmId: string };
}

/**
 * Branch scoping. Global roles may query any branch within their own firm
 * (or all of them); everyone else is pinned to the branch they belong to,
 * whatever the request asks for. `firmId` is always the caller's own
 * resolved tenant — every query built from this result MUST also filter by
 * it.
 */
export function resolveBranchScope(
  user: SessionUser,
  requestedBranchId?: string | null,
): { branchId?: string; canSeeAllBranches: boolean; firmId: string } {
  const firmId = requireFirmId(user);
  const canSeeAllBranches =
    isGlobalRole(user.role) ||
    user.permissions.includes("dashboard.view_all_branches" as PermissionCode);

  if (!canSeeAllBranches) {
    return { branchId: user.branchId ?? "__no_branch__", canSeeAllBranches: false, firmId };
  }

  if (requestedBranchId === "all") {
    return { branchId: undefined, canSeeAllBranches: true, firmId };
  }

  if (requestedBranchId) {
    return { branchId: requestedBranchId, canSeeAllBranches: true, firmId };
  }

  if (user.branchId) {
    return { branchId: user.branchId, canSeeAllBranches: true, firmId };
  }

  return { branchId: undefined, canSeeAllBranches: true, firmId };
}

/**
 * Throws if a user tries to touch a record belonging to another branch.
 * Firm-safe by construction: a user's own branchId is only ever assigned
 * from a branch in their own firm (enforced at staff-creation time).
 */
export function assertBranchAccess(user: SessionUser, branchId: string | null) {
  if (isGlobalRole(user.role)) return;
  if (!branchId) return;
  if (user.branchId !== branchId) {
    throw new AuthorizationError("This record belongs to a different branch");
  }
}

/**
 * Throws (403-equivalent) if a fetched record's own firmId doesn't match
 * the caller's active firm.
 */
export function assertFirmAccess(user: SessionUser, recordFirmId: string | null | undefined) {
  const firmId = requireFirmId(user);
  if (recordFirmId !== firmId) {
    throw new AuthorizationError("This record belongs to a different organization");
  }
}

/**
 * The branch a newly created record should be filed under. For a global
 * role that requested a specific branch, the branch is verified to belong
 * to the caller's own firm before being trusted.
 */
export async function requireWriteBranch(
  user: SessionUser,
  requestedBranchId?: string | null,
): Promise<string> {
  const firmId = requireFirmId(user);

  if (isGlobalRole(user.role)) {
    const branchId = requestedBranchId ?? user.branchId;
    if (branchId) {
      // Always validate: the session fallback can go stale after data resets.
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { firmId: true },
      });
      if (branch && branch.firmId === firmId) return branchId;
    }
    if (requestedBranchId) {
      throw new AuthorizationError("That branch does not belong to your organization");
    }
    // No saved location (or a stale one) — recover by using the firm's first
    // active branch rather than forcing the user to sign out and back in.
    // An unselected-but-valid work location must not block a create the user
    // is otherwise permitted to make.
    const fallback = await prisma.branch.findFirst({
      where: { firmId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!fallback) {
      throw new AuthorizationError(
        "This firm has no active branch yet — add one in Firms before creating records",
      );
    }
    return fallback.id;
  }

  if (!user.branchId) {
    throw new AuthorizationError("Your account is not assigned to a branch");
  }
  if (requestedBranchId && requestedBranchId !== user.branchId) {
    throw new AuthorizationError("You can only create records for your own branch");
  }
  // Validate the account's branch still exists in this firm.
  const branch = await prisma.branch.findUnique({
    where: { id: user.branchId },
    select: { firmId: true },
  });
  if (!branch || branch.firmId !== firmId) {
    throw new AuthorizationError(
      "Your work location is no longer valid — ask an administrator to check your account",
    );
  }
  return user.branchId;
}
