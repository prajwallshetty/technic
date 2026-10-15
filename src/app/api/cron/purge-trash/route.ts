import { NextResponse } from "next/server";
import { purgeExpiredFirms } from "@/lib/firm-trash.server";
import { getCurrentUser } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";

/**
 * Scheduled cleanup endpoint for 100-day soft-delete retention expiration.
 * Invoked by external cron services (e.g. Vercel Cron, GitHub Actions, cloud scheduler)
 * or triggered by an authenticated Super Admin.
 *
 * Security:
 * Requires either:
 * 1. Bearer token matching CRON_SECRET environment variable.
 * 2. Authenticated Super Admin session.
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    const isAuthorizedCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isAuthorizedCron) {
      const user = await getCurrentUser();
      if (!user || !isPlatformRole(user.role)) {
        return NextResponse.json(
          { error: "Forbidden: Super Admin or valid cron secret required" },
          { status: 403 },
        );
      }
    }

    const result = await purgeExpiredFirms();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to purge expired firms" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
