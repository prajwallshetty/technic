import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { resolvePermissions } from "@/lib/permissions.server";
import { isPlatformRole } from "@/lib/rbac";
import type { PermissionCode } from "@/lib/rbac";
import type { AccessView } from "@/types/next-auth";
import type { UserRole } from "@/generated/prisma/enums";

const credentialsSchema = z.object({
  accessCode: z.string().trim().min(1),
});

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        accessCode: { label: "Access code", type: "text" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { accessCode: parsed.data.accessCode },
          include: {
          branch: { select: { id: true, name: true, code: true } },
          firm: { select: { id: true, name: true, status: true, deletedAt: true } },
        },
      });

      if (!user || user.status !== "ACTIVE") return null;

      // A firm's users cannot sign in while their firm is deactivated or
      // sitting in the trash.
      if (user.firm && (user.firm.status !== "ACTIVE" || user.firm.deletedAt)) return null;

        const permissions = await resolvePermissions(user.id, user.role);

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const canSwitchFirms = isPlatformRole(user.role) || user.role === "ADMIN" || permissions.includes("firms.manage" as const);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          branchId: user.branchId,
          branchName: user.branch?.name ?? null,
          branchCode: user.branch?.code ?? null,
          employeeCode: user.employeeCode,
          permissions,
          firmId: user.firmId,
          firmName: user.firm?.name ?? null,
          // A regular firm user's active firm is always their own, fixed
          // firm — never switchable. A PLATFORM_ADMIN, ADMIN, or user with
          // FIRMS_MANAGE permission starts with none active until they
          // explicitly enter one from the Firms module.
          activeFirmId: canSwitchFirms ? null : user.firmId,
          activeFirmName: canSwitchFirms ? null : (user.firm?.name ?? null),
          // The reporting view is a property of the user record. COMBINED is
          // the default full view; the seeded GST-reconciliation admin runs
          // in GST_ONLY. Server-side always — never client-supplied.
          accessView: (user.accessView === "GST_ONLY" ? "GST_ONLY" : "COMBINED") as AccessView,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.branchId = user.branchId;
        token.branchName = user.branchName;
        token.branchCode = user.branchCode;
        token.employeeCode = user.employeeCode;
        token.permissions = user.permissions;
        token.firmId = user.firmId;
        token.firmName = user.firmName;
        token.activeFirmId = user.activeFirmId;
        token.activeFirmName = user.activeFirmName;
        token.accessView = (user as { accessView?: AccessView }).accessView ?? "COMBINED";
      }

      // Re-read role/branch/permissions when the client explicitly asks for a
      // refresh (e.g. after an admin changes this user's access or their
      // reporting view), and handle the Firms-module "enter firm" switch
      // (PLATFORM_ADMIN only).
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          include: {
            branch: { select: { id: true, name: true, code: true } },
            firm: { select: { id: true, name: true, deletedAt: true } },
          },
        });
        const payload = updateData as {
          activeFirmId?: string | null;
          branchId?: string | null;
          branchName?: string | null;
          branchCode?: string | null;
        } | undefined;

        if (fresh && fresh.status === "ACTIVE" && !fresh.firm?.deletedAt) {
          token.role = fresh.role;
          // Keep the work branch chosen for the active firm; only fall back to
          // the account's own branch when no other firm is being operated in.
          if (payload?.branchId === undefined) {
            if (!token.activeFirmId || token.activeFirmId === fresh.firmId) {
              token.branchId = fresh.branchId;
              token.branchName = fresh.branch?.name ?? null;
              token.branchCode = fresh.branch?.code ?? null;
            }
          }
          token.permissions = await resolvePermissions(fresh.id, fresh.role);
          token.firmId = fresh.firmId;
          token.firmName = fresh.firm?.name ?? null;
          // An admin can flip a user's reporting view (e.g. granting the
          // GST-reconciliation view); pick it up on the next refresh.
          token.accessView = fresh.accessView === "GST_ONLY" ? "GST_ONLY" : "COMBINED";
        }

        const requestedFirmId = payload?.activeFirmId;
        const canSwitchFirms = isPlatformRole(token.role as UserRole) || token.role === "ADMIN" || (token.permissions as string[]).includes("firms.manage");
        if (requestedFirmId !== undefined && canSwitchFirms) {
          if (requestedFirmId === null) {
            token.activeFirmId = null;
            token.activeFirmName = null;
          } else {
            const targetFirm = await prisma.firm.findUnique({
              where: { id: requestedFirmId },
              select: { id: true, name: true, status: true, deletedAt: true },
            });
            if (targetFirm && targetFirm.status === "ACTIVE" && !targetFirm.deletedAt) {
              token.activeFirmId = targetFirm.id;
              token.activeFirmName = targetFirm.name;
              // Repoint the work location at a branch of the new firm.
              const targetBranch = await prisma.branch.findFirst({
                where: { firmId: targetFirm.id, isActive: true },
                select: { id: true, name: true, code: true },
              });
              token.branchId = targetBranch?.id ?? null;
              token.branchName = targetBranch?.name ?? null;
              token.branchCode = targetBranch?.code ?? null;
            }
          }
        } else if (payload?.branchId !== undefined) {
          // Explicit branch switch requested
          if (payload.branchId === null || payload.branchId === "all") {
            token.branchId = null;
            token.branchName = null;
            token.branchCode = null;
          } else {
            const targetBranch = await prisma.branch.findUnique({
              where: { id: payload.branchId },
              select: { id: true, name: true, code: true, firmId: true, isActive: true },
            });
            if (targetBranch && targetBranch.isActive && (!token.activeFirmId || targetBranch.firmId === token.activeFirmId)) {
              token.branchId = targetBranch.id;
              token.branchName = targetBranch.name;
              token.branchCode = targetBranch.code;
            }
          }
        } else if (token.activeFirmId) {
          // Session refresh while operating inside a firm: the branch must
          // belong to the ACTIVE firm, not merely to the user's own account.
          const activeBranchOk =
            token.branchId &&
            (await prisma.branch.findFirst({
              where: { id: token.branchId as string, firmId: token.activeFirmId as string },
              select: { id: true },
            }));
          if (!activeBranchOk) {
            const fallback = await prisma.branch.findFirst({
              where: { firmId: token.activeFirmId as string, isActive: true },
              select: { id: true, name: true, code: true },
            });
            token.branchId = fallback?.id ?? null;
            token.branchName = fallback?.name ?? null;
            token.branchCode = fallback?.code ?? null;
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.branchId = (token.branchId as string | null) ?? null;
        session.user.branchName = (token.branchName as string | null) ?? null;
        session.user.branchCode = (token.branchCode as string | null) ?? null;
        session.user.employeeCode = (token.employeeCode as string | null) ?? null;
        session.user.permissions = (token.permissions as PermissionCode[]) ?? [];
        session.user.firmId = (token.firmId as string | null) ?? null;
        session.user.firmName = (token.firmName as string | null) ?? null;
        session.user.activeFirmId = (token.activeFirmId as string | null) ?? null;
        session.user.activeFirmName = (token.activeFirmName as string | null) ?? null;
        session.user.accessView = token.accessView === "GST_ONLY" ? "GST_ONLY" : "COMBINED";
      }
      return session;
    },
  },
});
