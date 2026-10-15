import Link from "next/link";
import { Settings } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnterFirmButton } from "./enter-button";
import { CreateFirmButton } from "./create-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { isPlatformRole } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Firms — Technic Technologies" };

const firmCounts = { _count: { select: { users: true, branches: true, products: true } } } as const;

export default async function FirmsPage() {
  const user = await requirePermission("firms.view");
  const platformAdmin = isPlatformRole(user.role);
  const isAdmin = user.role === "ADMIN";
  const canManageFirms = user.permissions.includes("firms.manage" as const);
  const canSwitchFirms = platformAdmin || isAdmin || canManageFirms;

  const firms = await prisma.firm.findMany({
    where: canSwitchFirms ? { deletedAt: null } : { id: user.firmId ?? "", deletedAt: null },
    orderBy: { name: "asc" },
    include: firmCounts,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Firms & Organizations"
        description={
          canSwitchFirms
            ? "Select a firm to operate in — its data, users, and branches. Open Firm Settings to manage or configure."
            : "Your firm registration and details"
        }
        actions={canManageFirms ? <CreateFirmButton /> : null}
      />

      {firms.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No active firms found. Click &quot;Create Firm&quot; to register a new firm.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {firms.map((firm) => (
            <Card key={firm.id} className="transition-shadow hover:shadow-xs">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="truncate">{firm.displayName || firm.name}</span>
                  <Badge tone={firm.status === "ACTIVE" ? "success" : "danger"}>{firm.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm">
                <p className="text-muted-foreground">{firm.legalName ?? firm.name}</p>
                {firm.gstin ? (
                  <p className="font-mono text-xs">GSTIN {firm.gstin}</p>
                ) : (
                  <p className="text-xs text-warning">No GSTIN registered</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {[firm.city, firm.state].filter(Boolean).join(", ") || "Location not set"}
                  {" · FY "}
                  {firm.financialYear}
                </p>
                <p className="text-xs text-muted-foreground">
                  {firm._count.users} users · {firm._count.branches} branches · {firm._count.products} products
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5">
                  <span className="text-xs text-muted-foreground">
                    Created {formatDate(firm.createdAt)}
                  </span>
                  <div className="flex items-center gap-2">
                    {canSwitchFirms ? (
                      user.activeFirmId === firm.id ? (
                        <Badge tone="success">Operating here</Badge>
                      ) : (
                        <EnterFirmButton
                          firmId={firm.id}
                          firmName={firm.displayName || firm.name}
                          disabled={firm.status !== "ACTIVE"}
                        />
                      )
                    ) : null}

                    {/* Firm Settings link - all Edit & Delete actions live inside Firm Settings */}
                    <Button asChild size="sm" variant="outline" title="Firm settings">
                      <Link href={`/firms/${firm.id}/settings`}>
                        <Settings className="mr-1.5 h-4 w-4" />
                        Firm Settings
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
