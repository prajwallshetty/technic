import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateBranchButton } from "./create-button";
import { EditBranchButton } from "./edit-button";
import { DeleteBranchButton } from "./delete-button";
import { SetWorkBranchButton } from "./set-work-branch-button";
import { prisma } from "@/lib/prisma";
import { requirePermission, requireFirmId } from "@/lib/session";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Branches & Locations — Technic Technologies" };

export default async function BranchesPage() {
  const user = await requirePermission("firms.view");
  const firmId = requireFirmId(user);
  const canManage = user.permissions.includes("firms.manage" as const);

  const branches = await prisma.branch.findMany({
    where: { firmId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: {
          users: true,
          invoices: true,
          purchaseOrders: true,
          serialUnits: true,
        },
      },
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Branches & Showrooms"
        description="Manage physical branch locations, warehouses, showrooms and work centers"
        actions={canManage ? <CreateBranchButton /> : null}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {branches.map((branch) => {
          const isCurrent = user.branchId === branch.id;
          return (
            <Card key={branch.id} className={isCurrent ? "border-primary/50 shadow-xs" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate">{branch.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">({branch.code})</span>
                  </div>
                  <Badge tone={branch.isActive ? "success" : "danger"}>
                    {branch.isActive ? "ACTIVE" : "INACTIVE"}
                  </Badge>
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral" className="text-xs font-normal">
                    {branch.type.replace("_", " ")}
                  </Badge>
                  {branch.gstin && (
                    <span className="font-mono text-xs text-muted-foreground">GSTIN {branch.gstin}</span>
                  )}
                </div>

                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>{branch.addressLine || "Address not configured"}</p>
                  <p>
                    {[branch.city, branch.state, branch.pincode].filter(Boolean).join(", ") || "Location not set"}
                  </p>
                  {branch.phone && <p>Phone: {branch.phone}</p>}
                </div>

                <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  <div className="grid grid-cols-2 gap-1">
                    <span>👥 {branch._count.users} Users</span>
                    <span>📦 {branch._count.serialUnits} Serials</span>
                    <span>📄 {branch._count.invoices} Invoices</span>
                    <span>🛒 {branch._count.purchaseOrders} Purchases</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">
                    Added {formatDate(branch.createdAt)}
                  </span>

                  <div className="flex items-center gap-2">
                    <SetWorkBranchButton
                      branchId={branch.id}
                      branchName={branch.name}
                      isCurrent={isCurrent}
                      disabled={!branch.isActive}
                    />
                    {canManage && <EditBranchButton branch={branch} />}
                    {canManage && branches.length > 1 && (
                      <DeleteBranchButton
                        branchId={branch.id}
                        branchName={branch.name}
                        branchCode={branch.code}
                      />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
