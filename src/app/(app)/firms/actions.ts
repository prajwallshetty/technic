"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { AuthenticationError, AuthorizationError, getCurrentUser } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TRASH_RETENTION_DAYS, trashRetentionElapsed } from "@/lib/firm-trash";
import { unstable_update } from "@/auth";

export async function enterFirmAction(input: { firmId: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!isPlatformRole(user.role) && user.role !== "ADMIN" && !user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("Only a Super Admin, Admin, or user with firm management permission can switch firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, name: true, status: true, deletedAt: true },
    });
    if (!firm || firm.status !== "ACTIVE") {
      throw new BusinessRuleError("That firm is not active — reactivate it from Firm Management first");
    }
    if (firm.deletedAt) {
      throw new BusinessRuleError("That firm is in the trash — restore it first");
    }

    // Find a usable branch in the new firm to assign as the work location.
    const branch = await prisma.branch.findFirst({
      where: { firmId: firm.id, isActive: true },
      select: { id: true, name: true, code: true },
    });

    await unstable_update({
      activeFirmId: firm.id,
      activeFirmName: firm.name,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      branchCode: branch?.code ?? null,
    } as never);

    revalidatePath("/", "layout");
    return { entered: true };
  });
}

export async function createFirmAction(input: {
  code: string;
  name: string;
  legalName?: string;
  displayName?: string;
  gstin?: string;
  pan?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo?: string;
  invoicePrefix?: string;
  quotationPrefix?: string;
  purchasePrefix?: string;
  financialYear?: string;
}) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("You do not have permission to create firms");
    }

    const code = input.code.trim().toUpperCase();
    if (!code) throw new BusinessRuleError("Firm code is required");
    if (!input.name.trim()) throw new BusinessRuleError("Firm name is required");

    // Check if firm code already exists
    const existing = await prisma.firm.findUnique({
      where: { code },
      select: { code: true, deletedAt: true },
    });
    if (existing) {
      throw new BusinessRuleError(
        existing.deletedAt
          ? "A firm with this code already exists — it is sitting in the trash, restore or purge it first"
          : "A firm with this code already exists",
      );
    }

    const firm = await prisma.firm.create({
      data: {
        code,
        name: input.name.trim(),
        legalName: input.legalName?.trim() || input.name.trim(),
        displayName: input.displayName?.trim() || null,
        gstin: input.gstin ? input.gstin.trim().toUpperCase() : null,
        pan: input.pan ? input.pan.trim().toUpperCase() : null,
        addressLine: input.addressLine?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        stateCode: input.stateCode?.trim() || null,
        pincode: input.pincode?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        website: input.website?.trim() || null,
        logoUrl: input.logo?.trim() || null,
        invoicePrefix: input.invoicePrefix?.trim() || "INV",
        quotationPrefix: input.quotationPrefix?.trim() || "QT",
        purchasePrefix: input.purchasePrefix?.trim() || "PO",
        financialYear: input.financialYear?.trim() || "26-27",
        status: "ACTIVE",
        branches: {
          create: {
            code: "HO",
            name: "Head Office",
            type: "HEAD_OFFICE",
            addressLine: input.addressLine?.trim() || null,
            city: input.city?.trim() || null,
            state: input.state?.trim() || null,
            stateCode: input.stateCode?.trim() || null,
            pincode: input.pincode?.trim() || null,
            phone: input.phone?.trim() || null,
            email: input.email?.trim() || null,
            gstin: input.gstin ? input.gstin.trim().toUpperCase() : null,
            isActive: true,
          },
        },
      },
    });

    revalidatePath("/firms");
    return { created: true, firmId: firm.id };
  });
}

export async function editFirmAction(input: {
  firmId: string;
  name: string;
  legalName?: string;
  displayName?: string;
  gstin?: string;
  pan?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo?: string;
  invoicePrefix?: string;
  quotationPrefix?: string;
  purchasePrefix?: string;
  financialYear?: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!isPlatformRole(user.role) || !user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("Only Super Admin can edit firm details");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
    });
    if (!firm) {
      throw new NotFoundError("Firm not found");
    }

    if (!input.name.trim()) throw new BusinessRuleError("Firm legal name is required");

    // Prevent deactivating firm if caller is operating in it right now
    if (input.status === "INACTIVE" && user.activeFirmId === firm.id) {
      throw new BusinessRuleError("Cannot deactivate the firm you are currently operating in. Switch to another firm first.");
    }

    const updated = await prisma.firm.update({
      where: { id: input.firmId },
      data: {
        name: input.name.trim(),
        legalName: input.legalName?.trim() || input.name.trim(),
        displayName: input.displayName?.trim() || null,
        gstin: input.gstin ? input.gstin.trim().toUpperCase() : null,
        pan: input.pan ? input.pan.trim().toUpperCase() : null,
        addressLine: input.addressLine?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        stateCode: input.stateCode?.trim() || null,
        pincode: input.pincode?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        website: input.website?.trim() || null,
        logoUrl: input.logo?.trim() || null,
        invoicePrefix: input.invoicePrefix?.trim() || firm.invoicePrefix,
        quotationPrefix: input.quotationPrefix?.trim() || firm.quotationPrefix,
        purchasePrefix: input.purchasePrefix?.trim() || firm.purchasePrefix,
        financialYear: input.financialYear?.trim() || firm.financialYear,
        status: input.status,
      },
    });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: firm.id,
      summary: `Updated firm ${firm.code} (${updated.displayName || updated.name}) — status ${updated.status}`,
      before: { status: firm.status, name: firm.name },
      after: { status: updated.status, name: updated.name },
      firmId: firm.id,
      userId: user.id,
    });

    revalidatePath("/firms");
    revalidatePath("/trash");
    revalidatePath(`/firms/${input.firmId}/settings`);
    return { updated: true };
  });
}

/** Toggle firm status between ACTIVE and INACTIVE (Deactivate / Reactivate). */
export async function toggleFirmStatusAction(input: { firmId: string; status: "ACTIVE" | "INACTIVE" }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!isPlatformRole(user.role) || !user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("Only Super Admin can manage firm status");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, code: true, name: true, displayName: true, status: true, deletedAt: true },
    });
    if (!firm) throw new NotFoundError("Firm not found");
    if (firm.deletedAt) throw new BusinessRuleError("That firm is in the trash — restore it first");

    if (input.status === "INACTIVE" && user.activeFirmId === firm.id) {
      throw new BusinessRuleError("Cannot deactivate the firm you are currently operating in. Switch to another firm first.");
    }

    await prisma.firm.update({
      where: { id: firm.id },
      data: { status: input.status },
    });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: firm.id,
      summary: `${input.status === "INACTIVE" ? "Deactivated" : "Reactivated"} firm ${firm.code} (${firm.displayName || firm.name})`,
      before: { status: firm.status },
      after: { status: input.status },
      firmId: firm.id,
      userId: user.id,
    });

    revalidatePath("/firms");
    revalidatePath("/trash");
    revalidatePath(`/firms/${firm.id}/settings`);
    return { status: input.status };
  });
}

export async function trashFirmAction(input: { firmId: string; confirmation: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!isPlatformRole(user.role) || !user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("Only Super Admin can move firms to the trash");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, code: true, name: true, displayName: true, deletedAt: true },
    });
    if (!firm) throw new NotFoundError("Firm not found");
    if (firm.deletedAt) throw new BusinessRuleError("That firm is already in the trash");

    const typed = (input.confirmation ?? "").trim();
    if (!typed) throw new BusinessRuleError(`Type ${firm.code} to confirm`);
    if (typed.toUpperCase() !== firm.code.toUpperCase()) {
      throw new BusinessRuleError("The confirmation does not match this firm's code");
    }

    if (user.activeFirmId === firm.id) {
      throw new BusinessRuleError("You are operating in this firm right now — switch to another firm first");
    }

    const deletedAt = new Date();
    await prisma.firm.update({ where: { id: firm.id }, data: { deletedAt } });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: firm.id,
      summary: `Moved firm ${firm.code} (${firm.displayName || firm.name}) to the trash — purged after ${TRASH_RETENTION_DAYS} days`,
      before: { deletedAt: null },
      after: { deletedAt: deletedAt.toISOString() },
      firmId: firm.id,
      userId: user.id,
    });

    revalidatePath("/firms");
    revalidatePath("/trash");
    revalidatePath(`/firms/${firm.id}/settings`);
    return { trashed: true };
  });
}

export async function restoreFirmAction(input: { firmId: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!isPlatformRole(user.role) || !user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("Only Super Admin can restore firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      select: { id: true, code: true, name: true, displayName: true, deletedAt: true },
    });
    if (!firm) throw new NotFoundError("Firm not found");
    if (!firm.deletedAt) throw new BusinessRuleError("That firm is not in the trash");
    if (trashRetentionElapsed(firm.deletedAt)) {
      throw new BusinessRuleError(
        `Its ${TRASH_RETENTION_DAYS}-day retention has expired — this firm can no longer be restored`,
      );
    }

    // Clear soft-delete timestamp while preserving existing firm status (active or inactive)
    await prisma.firm.update({
      where: { id: firm.id },
      data: { deletedAt: null },
    });

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: firm.id,
      summary: `Restored firm ${firm.code} (${firm.displayName || firm.name}) from the trash`,
      before: { deletedAt: firm.deletedAt.toISOString() },
      after: { deletedAt: null },
      firmId: firm.id,
      userId: user.id,
    });

    revalidatePath("/firms");
    revalidatePath("/trash");
    revalidatePath(`/firms/${firm.id}/settings`);
    return { restored: true };
  });
}

/**
 * Permanently purges a trashed firm.
 * Strict Integrity Enforcement:
 * Permanently deletes ONLY if the firm contains zero dependent business/financial records
 * (invoices, payments, purchases, sales orders, stock movements, customers, suppliers).
 * If dependent records exist, permanent deletion is BLOCKED with a clear explanation.
 */
export async function purgeFirmAction(input: { firmId: string; confirmation: string }) {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationError("Sign in again");
    if (!isPlatformRole(user.role) || !user.permissions.includes("firms.manage" as const)) {
      throw new AuthorizationError("Only Super Admin can permanently purge firms");
    }

    const firm = await prisma.firm.findUnique({
      where: { id: input.firmId },
      include: {
        _count: {
          select: {
            invoices: true,
            purchaseOrders: true,
            purchaseInvoices: true,
            quotations: true,
            salesOrders: true,
            salesReturns: true,
            payments: true,
            supplierPayments: true,
            products: true,
            stockTransactions: true,
            customers: true,
            suppliers: true,
            expenses: true,
            warranties: true,
          },
        },
      },
    });
    if (!firm) throw new NotFoundError("Firm not found");
    if (!firm.deletedAt) {
      throw new BusinessRuleError("That firm is not in the trash — move it to trash before purging");
    }

    const typed = (input.confirmation ?? "").trim();
    if (!typed || typed.toUpperCase() !== firm.code.toUpperCase()) {
      throw new BusinessRuleError(`Type ${firm.code} to confirm permanent deletion`);
    }

    if (user.activeFirmId === firm.id) {
      throw new BusinessRuleError("Cannot purge the firm you are currently operating in");
    }

    // Evaluate dependent records
    const counts = firm._count;
    const parts: string[] = [];
    if (counts.invoices > 0) parts.push(`${counts.invoices} invoices`);
    if (counts.purchaseOrders > 0 || counts.purchaseInvoices > 0) parts.push(`${counts.purchaseOrders + counts.purchaseInvoices} purchases`);
    if (counts.quotations > 0) parts.push(`${counts.quotations} quotations`);
    if (counts.salesOrders > 0) parts.push(`${counts.salesOrders} sales orders`);
    if (counts.payments > 0 || counts.supplierPayments > 0) parts.push(`${counts.payments + counts.supplierPayments} payments`);
    if (counts.stockTransactions > 0) parts.push(`${counts.stockTransactions} stock movements`);
    if (counts.products > 0) parts.push(`${counts.products} products`);
    if (counts.customers > 0) parts.push(`${counts.customers} customers`);
    if (counts.suppliers > 0) parts.push(`${counts.suppliers} suppliers`);

    if (parts.length > 0) {
      throw new BusinessRuleError(
        `Cannot permanently delete "${firm.displayName || firm.name}": it holds dependent business records (${parts.join(", ")}). Historical financial and inventory records must be preserved for audit and accounting compliance. Deactivate the firm or keep it in the trash instead.`
      );
    }

    // Zero dependent records -> safe to permanently drop DB row
    try {
      // Clean up setup tables (branches, document sequences) if any
      await prisma.$transaction([
        prisma.documentSequence.deleteMany({ where: { firmId: firm.id } }),
        prisma.setting.deleteMany({ where: { firmId: firm.id } }),
        prisma.branch.deleteMany({ where: { firmId: firm.id } }),
        prisma.firm.delete({ where: { id: firm.id } }),
      ]);
    } catch {
      throw new BusinessRuleError("Failed to purge firm record from database");
    }

    await recordAudit({
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: firm.id,
      summary: `Permanently purged firm ${firm.code} (${firm.displayName || firm.name})`,
      before: { deletedAt: firm.deletedAt.toISOString() },
      after: null,
      firmId: null,
      userId: user.id,
    });

    revalidatePath("/firms");
    revalidatePath("/trash");
    revalidatePath(`/firms/${firm.id}/settings`);
    return { purged: true };
  });
}
