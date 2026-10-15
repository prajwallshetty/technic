import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { errorStatus } from "@/lib/action-result";
import { createBranchAction } from "@/app/(app)/branches/actions";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const firmId = user.activeFirmId || user.firmId;
    if (!firmId) return NextResponse.json({ branches: [] });

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("all") === "true";

    const branches = await prisma.branch.findMany({
      where: {
        firmId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        gstin: true,
        addressLine: true,
        city: true,
        state: true,
        stateCode: true,
        pincode: true,
        phone: true,
        email: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            users: true,
            invoices: true,
            purchaseOrders: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const canSeeAllBranches =
      user.role === "PLATFORM_ADMIN" ||
      user.role === "ADMIN" ||
      user.role === "MANAGER" ||
      user.permissions.includes("dashboard.view_all_branches" as never);

    return NextResponse.json({ branches, canSeeAllBranches });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createBranchAction(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
