import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { authorize } from "@/lib/session";
import { errorStatus } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { TRASH_RETENTION_DAYS } from "@/lib/firm-trash";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authorize("firms.view");

    const { id } = await params;

    const firm = await prisma.firm.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        legalName: true,
        displayName: true,
        gstin: true,
        pan: true,
        addressLine: true,
        city: true,
        state: true,
        stateCode: true,
        pincode: true,
        phone: true,
        email: true,
        website: true,
        invoicePrefix: true,
        quotationPrefix: true,
        purchasePrefix: true,
        financialYear: true,
        status: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!firm) {
      return NextResponse.json({ error: "Firm not found" }, { status: 404 });
    }

    // Non-platform admins can only view their own firm
    if (user.role !== "PLATFORM_ADMIN" && user.firmId !== firm.id) {
      return NextResponse.json({ error: "You can only view your own firm" }, { status: 403 });
    }

    return NextResponse.json(firm);
  } catch (error) {
    console.error("Error fetching firm:", error);
    return NextResponse.json({ error: "Failed to fetch firm" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authorize("firms.manage");

    const { id } = await params;

    const firm = await prisma.firm.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, displayName: true, deletedAt: true },
    });

    if (!firm) {
      return NextResponse.json({ error: "Firm not found" }, { status: 404 });
    }

    if (firm.deletedAt) {
      return NextResponse.json({ error: "That firm is already in the trash" }, { status: 409 });
    }

    // Soft delete: the firm is hidden straight away and kept for
    // TRASH_RETENTION_DAYS before it is purged for good. The caller must echo
    // the firm code back — checked here, never only in the browser.
    const body = (await request.json().catch(() => ({}))) as { confirmation?: unknown };
    const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";

    if (!confirmation) {
      return NextResponse.json(
        { error: "Confirmation required", requiresConfirmation: firm.code },
        { status: 400 }
      );
    }
    if (confirmation.toUpperCase() !== firm.code.toUpperCase()) {
      return NextResponse.json({ error: "Confirmation does not match this firm's code" }, { status: 400 });
    }

    // Prevent trashing the firm the caller is currently operating in
    if (user.activeFirmId === id) {
      return NextResponse.json(
        { error: "Cannot trash the firm you are currently operating in. Switch to another firm first." },
        { status: 400 }
      );
    }

    const deletedAt = new Date();
    await prisma.firm.update({ where: { id }, data: { deletedAt } });

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
    revalidatePath(`/firms/${firm.id}/settings`);

    return NextResponse.json({
      trashed: true,
      purgeAfterDays: TRASH_RETENTION_DAYS,
    });
  } catch (error) {
    // Authorization / authentication failures keep their real status code;
    // anything unexpected stays a generic 500.
    const status = errorStatus(error);
    if (status >= 400 && status < 500) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Request refused" },
        { status },
      );
    }
    console.error("Error trashing firm:", error);
    return NextResponse.json({ error: "Failed to move firm to the trash" }, { status: 500 });
  }
}
