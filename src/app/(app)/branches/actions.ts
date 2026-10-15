"use server";

import { revalidatePath } from "next/cache";
import type { BranchType } from "@/generated/prisma/enums";

import { runAction, BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { AuthenticationError, AuthorizationError, getCurrentUser, requireFirmId } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { unstable_update } from "@/auth";

export async function createBranchAction(input: {
  code: string;
  name: string;
  type?: BranchType;
  gstin?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  phone?: string;
  email?: string;
}) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to create branches");
    }

    const firmId = requireFirmId(user);
    const code = input.code.trim().toUpperCase();
    if (!code) throw new BusinessRuleError("Branch code is required");
    if (!input.name.trim()) throw new BusinessRuleError("Branch name is required");

    // Code must be unique within the firm
    const existing = await prisma.branch.findFirst({
      where: { firmId, code },
      select: { id: true },
    });
    if (existing) {
      throw new BusinessRuleError(`A branch with code "${code}" already exists in this firm`);
    }

    const branch = await prisma.branch.create({
      data: {
        firmId,
        code,
        name: input.name.trim(),
        type: input.type || "BRANCH",
        gstin: input.gstin ? input.gstin.trim().toUpperCase() : null,
        addressLine: input.addressLine ? input.addressLine.trim() : null,
        city: input.city ? input.city.trim() : null,
        state: input.state ? input.state.trim() : null,
        stateCode: input.stateCode ? input.stateCode.trim() : null,
        pincode: input.pincode ? input.pincode.trim() : null,
        phone: input.phone ? input.phone.trim() : null,
        email: input.email ? input.email.trim() : null,
        isActive: true,
      },
    });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Branch",
      entityId: branch.id,
      summary: `Created branch ${branch.code} (${branch.name})`,
      firmId,
      branchId: branch.id,
      userId: user.id,
    });

    revalidatePath("/branches");
    revalidatePath("/firms");
    return { created: true, branchId: branch.id };
  });
}

export async function editBranchAction(input: {
  branchId: string;
  name: string;
  type?: BranchType;
  gstin?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
}) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to edit branches");
    }

    const firmId = requireFirmId(user);
    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, firmId },
    });
    if (!branch) throw new NotFoundError("Branch not found in this firm");

    if (!input.name.trim()) throw new BusinessRuleError("Branch name is required");

    const updated = await prisma.branch.update({
      where: { id: branch.id },
      data: {
        name: input.name.trim(),
        type: input.type || branch.type,
        gstin: input.gstin ? input.gstin.trim().toUpperCase() : null,
        addressLine: input.addressLine ? input.addressLine.trim() : null,
        city: input.city ? input.city.trim() : null,
        state: input.state ? input.state.trim() : null,
        stateCode: input.stateCode ? input.stateCode.trim() : null,
        pincode: input.pincode ? input.pincode.trim() : null,
        phone: input.phone ? input.phone.trim() : null,
        email: input.email ? input.email.trim() : null,
        isActive: input.isActive,
      },
    });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Branch",
      entityId: branch.id,
      summary: `Updated branch ${branch.code} (${branch.name})`,
      firmId,
      branchId: branch.id,
      userId: user.id,
    });

    revalidatePath("/branches");
    revalidatePath("/firms");
    return { updated: true };
  });
}

export async function switchBranchAction(input: { branchId: string | null }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    const firmId = requireFirmId(user);

    const canSwitch =
      isPlatformRole(user.role) ||
      user.role === "ADMIN" ||
      user.role === "MANAGER" ||
      user.permissions.includes("dashboard.view_all_branches" as const) ||
      user.permissions.includes("firms.manage" as const);

    if (input.branchId === null || input.branchId === "all") {
      if (!canSwitch) {
        throw new AuthorizationError("You do not have permission to view all branches");
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { branchId: null },
      });
      await unstable_update({
        branchId: null,
        branchName: null,
        branchCode: null,
      } as never);

      revalidatePath("/", "layout");
      return { switched: true, branchName: "All Branches" };
    }

    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, firmId, isActive: true },
      select: { id: true, name: true, code: true },
    });
    if (!branch) {
      throw new BusinessRuleError("That branch is not active or does not belong to your firm");
    }

    if (!canSwitch && user.branchId !== branch.id) {
      throw new AuthorizationError("You are pinned to your assigned branch");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { branchId: branch.id },
    });

    await unstable_update({
      branchId: branch.id,
      branchName: branch.name,
      branchCode: branch.code,
    } as never);

    revalidatePath("/", "layout");
    return { switched: true, branchName: branch.name };
  });
}

export async function deleteBranchAction(input: { branchId: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to delete branches");
    }

    const firmId = requireFirmId(user);
    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, firmId },
      include: {
        _count: {
          select: {
            invoices: true,
            purchaseOrders: true,
            purchaseInvoices: true,
            quotations: true,
            salesOrders: true,
            serialUnits: true,
            stockTransactions: true,
          },
        },
      },
    });
    if (!branch) throw new NotFoundError("Branch not found in this firm");

    // Cannot delete the only branch of a firm
    const branchCount = await prisma.branch.count({ where: { firmId } });
    if (branchCount <= 1) {
      throw new BusinessRuleError("Cannot delete the only branch of the firm. Every firm must have at least one branch.");
    }

    // Check if transactional records are tied to this branch
    const txnCount =
      branch._count.invoices +
      branch._count.purchaseOrders +
      branch._count.purchaseInvoices +
      branch._count.quotations +
      branch._count.salesOrders +
      branch._count.serialUnits +
      branch._count.stockTransactions;

    if (txnCount > 0) {
      throw new BusinessRuleError(
        `Cannot delete branch "${branch.name}" because it has ${txnCount} active transaction/inventory record(s). You can mark it as Inactive instead.`
      );
    }

    // Find a fallback branch in the same firm to reassign staff users
    const fallbackBranch = await prisma.branch.findFirst({
      where: { firmId, id: { not: branch.id } },
      orderBy: { createdAt: "asc" },
    });

    if (fallbackBranch) {
      await prisma.user.updateMany({
        where: { branchId: branch.id },
        data: { branchId: fallbackBranch.id },
      });
    }

    // Delete the branch
    await prisma.branch.delete({
      where: { id: branch.id },
    });

    // If current session was on this branch, update session
    if (user.branchId === branch.id) {
      await prisma.user.update({
        where: { id: user.id },
        data: { branchId: fallbackBranch?.id ?? null },
      });
      await unstable_update({
        branchId: fallbackBranch?.id ?? null,
        branchName: fallbackBranch?.name ?? null,
        branchCode: fallbackBranch?.code ?? null,
      } as never);
    }

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Branch",
      entityId: branch.id,
      summary: `Deleted branch ${branch.code} (${branch.name})`,
      firmId,
      branchId: fallbackBranch?.id ?? null,
      userId: user.id,
    });

    revalidatePath("/branches");
    revalidatePath("/firms");
    revalidatePath("/", "layout");
    return { deleted: true };
  });
}

