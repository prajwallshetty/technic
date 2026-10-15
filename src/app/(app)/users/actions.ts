"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { UserRole } from "@/generated/prisma/enums";

const ASSIGNABLE_ROLES: UserRole[] = [
  "ADMIN",
  "MANAGER",
  "ACCOUNTANT",
  "SALES_STAFF",
  "PURCHASE_STAFF",
  "INVENTORY_MANAGER",
  "VIEWER",
];

export async function createUserAction(input: {
  name: string;
  email: string;
  accessCode: string;
  role: string;
  branchId: string;
}) {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const firmId = requireFirmId(actor);

    if (!/^\d{6}$/.test(input.accessCode)) {
      throw new BusinessRuleError("The login code must be exactly 6 digits");
    }
    if (!ASSIGNABLE_ROLES.includes(input.role as UserRole)) {
      throw new BusinessRuleError("That role cannot be assigned here");
    }

    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, firmId },
      select: { id: true },
    });
    if (!branch) throw new BusinessRuleError("That branch does not belong to your firm");

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email.toLowerCase() }, { accessCode: input.accessCode }] },
      select: { email: true },
    });
    if (existing) {
      throw new BusinessRuleError("A user with that email or login code already exists");
    }

    const maxCode = await prisma.user.findFirst({
      where: { firmId },
      orderBy: { employeeCode: "desc" },
      select: { employeeCode: true },
    });
    const nextNumber = maxCode?.employeeCode ? Number(maxCode.employeeCode.replace(/\D/g, "")) + 1 : 2;
    const employeeCode = `EMP${String(nextNumber).padStart(4, "0")}`;

    const user = await prisma.user.create({
      data: {
        firmId,
        employeeCode,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        accessCode: input.accessCode,
        role: input.role as UserRole,
        branchId: branch.id,
        status: "ACTIVE",
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      summary: `${user.name} (${input.role})`,
      firmId,
      userId: actor.id,
    });

    revalidatePath("/users");
    return { name: user.name };
  });
}

export async function updateUserAction(input: {
  id: string;
  name: string;
  email: string;
  accessCode?: string;
  role: string;
  branchId: string;
  status: "ACTIVE" | "SUSPENDED" | "INACTIVE";
}) {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const firmId = requireFirmId(actor);

    const targetUser = await prisma.user.findFirst({
      where: { id: input.id, firmId },
    });
    if (!targetUser) throw new BusinessRuleError("User not found in this organization");

    // Access code validation
    if (input.accessCode && input.accessCode.trim()) {
      if (!/^\d{6}$/.test(input.accessCode.trim())) {
        throw new BusinessRuleError("The login code must be exactly 6 digits");
      }
      const duplicateCode = await prisma.user.findFirst({
        where: { accessCode: input.accessCode.trim(), id: { not: input.id } },
        select: { id: true },
      });
      if (duplicateCode) {
        throw new BusinessRuleError("That 6-digit login code is already in use by another user");
      }
    }

    // Email uniqueness check
    const duplicateEmail = await prisma.user.findFirst({
      where: { email: input.email.trim().toLowerCase(), id: { not: input.id } },
      select: { id: true },
    });
    if (duplicateEmail) {
      throw new BusinessRuleError("A user with that email already exists");
    }

    // Role check
    const isPlatformAdmin = targetUser.role === "PLATFORM_ADMIN";
    const updatedRole = isPlatformAdmin ? targetUser.role : (input.role as UserRole);
    if (!isPlatformAdmin && !ASSIGNABLE_ROLES.includes(updatedRole)) {
      throw new BusinessRuleError("That role cannot be assigned here");
    }

    // Branch check
    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, firmId },
      select: { id: true },
    });
    if (!branch) throw new BusinessRuleError("That branch does not belong to your firm");

    const updated = await prisma.user.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: updatedRole,
        branchId: branch.id,
        status: input.status,
        ...(input.accessCode && input.accessCode.trim() ? { accessCode: input.accessCode.trim() } : {}),
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      action: "USER_UPDATED",
      entity: "User",
      entityId: updated.id,
      summary: `Updated user ${updated.name}`,
      firmId,
      userId: actor.id,
    });

    revalidatePath("/users");
    return { name: updated.name };
  });
}

export async function deleteUserAction(input: { id: string }) {
  return runAction(async () => {
    const actor = await authorize("users.manage");
    const firmId = requireFirmId(actor);

    if (actor.id === input.id) {
      throw new BusinessRuleError("You cannot delete your own account");
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: input.id, firmId },
    });
    if (!targetUser) throw new BusinessRuleError("User not found in this organization");

    if (targetUser.role === "PLATFORM_ADMIN") {
      throw new BusinessRuleError("Platform administrator accounts cannot be deleted here");
    }

    await prisma.user.delete({
      where: { id: input.id },
    });

    await recordAudit({
      action: "USER_UPDATED",
      entity: "User",
      entityId: targetUser.id,
      summary: `Deleted user ${targetUser.name} (${targetUser.email})`,
      firmId,
      userId: actor.id,
    });

    revalidatePath("/users");
    return { deleted: true, name: targetUser.name };
  });
}

