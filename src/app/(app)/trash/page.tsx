import { redirect } from "next/navigation";
import { Trash2, AlertTriangle, Building2, Clock, CheckCircle } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { purgeExpiredFirms } from "@/lib/firm-trash.server";
import {
  TRASH_RETENTION_DAYS,
  trashDaysLeft,
  trashRetentionEnd,
  trashRetentionElapsed,
} from "@/lib/firm-trash";
import { RestoreFirmButton } from "../firms/restore-button";
import { PurgeFirmButton } from "../firms/purge-button";

export const metadata = { title: "Trash & Retention — Technic Technologies" };

export default async function TrashPage() {
  const user = await requirePermission("firms.manage");
  if (!isPlatformRole(user.role)) {
    redirect("/forbidden");
  }

  // Trigger automated cleanup pass for any firms whose retention window elapsed
  await purgeExpiredFirms();

  const trashedFirms = await prisma.firm.findMany({
    where: { deletedAt: { not: null } },
    include: {
      _count: {
        select: {
          users: true,
          branches: true,
          products: true,
          invoices: true,
          customers: true,
          suppliers: true,
        },
      },
    },
    orderBy: { deletedAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trash & Retention"
        description="Firms soft-deleted by Super Admin are held for 100 calendar days before permanent deletion. Restore or purge firms below."
      />

      {/* Retention Policy Banner */}
      <Card className="border-border/60 bg-muted/30">
        <CardContent className="flex items-start gap-3 py-3.5 text-xs text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0 text-primary mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">100-Day Soft-Delete Protection Policy</p>
            <p>
              Soft-deleted firms are hidden from standard operations, search, and login. All historical records,
              branches, inventory transactions, and financial ledgers remain safely preserved. Super Admin may
              restore a firm at any point within the {TRASH_RETENTION_DAYS}-day recovery window. Permanent deletion is blocked
              if dependent business records exist.
            </p>
          </div>
        </CardContent>
      </Card>

      {trashedFirms.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
              <CheckCircle className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="text-sm font-medium text-foreground">Trash is empty</p>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              There are no soft-deleted firms currently in the recycle bin. Firms moved to trash from Firm Settings will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {trashedFirms.map((firm) => {
            if (!firm.deletedAt) return null;
            const expired = trashRetentionElapsed(firm.deletedAt);
            const daysLeft = trashDaysLeft(firm.deletedAt);
            const purgeOn = formatDate(trashRetentionEnd(firm.deletedAt));
            const recordsTotal =
              firm._count.users +
              firm._count.branches +
              firm._count.products +
              firm._count.invoices +
              firm._count.customers +
              firm._count.suppliers;

            return (
              <Card key={firm.id} className="border-border">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base font-semibold">
                        {firm.displayName || firm.name}
                      </CardTitle>
                      <span className="font-mono text-xs rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {firm.code}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {expired ? (
                        <Badge tone="danger" className="text-xs">
                          Retention Expired
                        </Badge>
                      ) : (
                        <Badge tone="warning" className="text-xs">
                          {daysLeft} day{daysLeft === 1 ? "" : "s"} left to restore
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">Deleted On:</span>{" "}
                      <span className="font-medium text-foreground">{formatDate(firm.deletedAt)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Eligible for Purge:</span>{" "}
                      <span className="font-medium text-foreground">{purgeOn}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Dependent Records:</span>{" "}
                      <span className="font-medium text-foreground">
                        {recordsTotal > 0 ? `${recordsTotal} records` : "0 records (Safe to drop)"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
                    <p className="text-xs text-muted-foreground">
                      {expired
                        ? "Retention expired. Permanent purge can be executed."
                        : `Can be restored to active service anytime before ${purgeOn}.`}
                    </p>

                    <div className="flex items-center gap-2">
                      {!expired && (
                        <RestoreFirmButton
                          firmId={firm.id}
                          firmName={firm.displayName || firm.name}
                        />
                      )}
                      <PurgeFirmButton
                        firmId={firm.id}
                        firmCode={firm.code}
                        firmName={firm.displayName || firm.name}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
