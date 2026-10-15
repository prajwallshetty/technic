import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { EditFirmButton } from "../../edit-button";
import { RestoreFirmButton } from "../../restore-button";
import { PurgeFirmButton } from "../../purge-button";
import { ToggleFirmStatusButton } from "../../toggle-status-button";
import { TrashFirmButton } from "./trash-button";
import {
  TRASH_RETENTION_DAYS,
  trashDaysLeft,
  trashRetentionEnd,
  trashRetentionElapsed,
} from "@/lib/firm-trash";

export const metadata = { title: "Firm settings — Technic Technologies" };

export default async function FirmSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("firms.view");

  const firm = await prisma.firm.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          users: true,
          branches: true,
          products: true,
          customers: true,
          suppliers: true,
          invoices: true,
        },
      },
    },
  });

  if (!firm) notFound();
  // Mirrors the API: anyone below a platform admin only sees their own firm.
  if (user.role !== "PLATFORM_ADMIN" && user.firmId !== firm.id) notFound();

  const canManage = isPlatformRole(user.role) && user.permissions.includes("firms.manage" as const);
  const inTrash = Boolean(firm.deletedAt);
  const recordCount =
    firm._count.users +
    firm._count.branches +
    firm._count.products +
    firm._count.customers +
    firm._count.suppliers +
    firm._count.invoices;

  const details: { label: string; value: string | null }[] = [
    { label: "Firm code", value: firm.code },
    { label: "Legal name", value: firm.legalName ?? firm.name },
    { label: "Display name", value: firm.displayName },
    { label: "GSTIN", value: firm.gstin },
    { label: "PAN", value: firm.pan },
    { label: "Address", value: firm.addressLine },
    { label: "City", value: firm.city },
    { label: "State", value: firm.state ? `${firm.state}${firm.stateCode ? ` (${firm.stateCode})` : ""}` : null },
    { label: "Pincode", value: firm.pincode },
    { label: "Phone", value: firm.phone },
    { label: "Email", value: firm.email },
    { label: "Website", value: firm.website },
    { label: "Invoice prefix", value: firm.invoicePrefix },
    { label: "Quotation prefix", value: firm.quotationPrefix },
    { label: "Purchase prefix", value: firm.purchasePrefix },
    { label: "Financial year", value: firm.financialYear },
    { label: "Created", value: formatDate(firm.createdAt) },
    { label: "Last updated", value: formatDate(firm.updatedAt) },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={firm.displayName || firm.name}
        description={`Firm settings · ${firm.code}`}
        backButton={
          <Button asChild variant="ghost" size="sm">
            <Link href="/firms">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to firms
            </Link>
          </Button>
        }
        actions={
          canManage && !inTrash ? (
            <EditFirmButton firmId={firm.id} firmName={firm.displayName || firm.name} />
          ) : null
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>Profile</span>
            <Badge tone={inTrash ? "danger" : firm.status === "ACTIVE" ? "success" : "neutral"}>
              {inTrash ? "IN TRASH" : firm.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {details.map((row) =>
              row.value ? (
                <div key={row.label} className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</dt>
                  <dd className="truncate text-sm">{row.value}</dd>
                </div>
              ) : null,
            )}
          </dl>
          <p className="text-xs text-muted-foreground">
            {firm._count.users} users · {firm._count.branches} branches · {firm._count.products} products ·{" "}
            {firm._count.customers} customers · {firm._count.suppliers} suppliers · {firm._count.invoices}{" "}
            invoices
          </p>
        </CardContent>
      </Card>

      {canManage ? (
        <Card className="border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <TriangleAlert className="h-4 w-4" />
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {inTrash && firm.deletedAt ? (
              <>
                <div className="space-y-1 text-sm">
                  <p>
                    This firm has been in the trash since{" "}
                    <strong>{formatDate(firm.deletedAt)}</strong>.
                  </p>
                  <p className="text-muted-foreground">
                    {trashRetentionElapsed(firm.deletedAt)
                      ? `Its ${TRASH_RETENTION_DAYS}-day retention has elapsed — it can no longer be restored.`
                      : `It can be restored until ${formatDate(trashRetentionEnd(firm.deletedAt))} — ${trashDaysLeft(
                          firm.deletedAt,
                        )} day${trashDaysLeft(firm.deletedAt) === 1 ? "" : "s"} left.`}
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {!trashRetentionElapsed(firm.deletedAt) && (
                    <RestoreFirmButton firmId={firm.id} firmName={firm.displayName || firm.name} />
                  )}
                  <PurgeFirmButton
                    firmId={firm.id}
                    firmCode={firm.code}
                    firmName={firm.displayName || firm.name}
                  />
                </div>
              </>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-xl space-y-1 text-sm">
                    <p>
                      Managing status for <strong>{firm.displayName || firm.name}</strong> ({firm.status}).
                    </p>
                    <p className="text-muted-foreground">
                      Deactivating a firm blocks new transactions while preserving 100% of historical records and ledgers.
                      Moving a firm to the trash soft-deletes it for {TRASH_RETENTION_DAYS} days. Permanent deletion is allowed only if no dependent business records exist.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ToggleFirmStatusButton
                      firmId={firm.id}
                      firmName={firm.displayName || firm.name}
                      currentStatus={firm.status as "ACTIVE" | "INACTIVE"}
                    />
                    <TrashFirmButton
                      firmId={firm.id}
                      firmCode={firm.code}
                      firmName={firm.displayName || firm.name}
                      recordCount={recordCount}
                    />
                  </div>
                </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
