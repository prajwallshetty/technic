import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { NewUserButton } from "./new-button";
import { EditUserButton } from "./edit-button";
import { DeleteUserButton } from "./delete-button";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/rbac";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Users — Technic Technologies" };

export default async function UsersPage() {
  const user = await requirePermissionInFirm("users.view");
  const canManage = user.permissions.includes("users.manage");

  const [users, branches] = await Promise.all([
    prisma.user.findMany({
      where: { firmId: user.activeFirmId },
      orderBy: { employeeCode: "asc" },
      include: { branch: { select: { id: true, name: true } } },
    }),
    prisma.branch.findMany({
      where: { firmId: user.activeFirmId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  interface Row {
    id: string;
    code: string | null;
    name: string;
    email: string;
    role: string;
    branchId: string | null;
    branch: string | null;
    status: "ACTIVE" | "SUSPENDED" | "INACTIVE";
    lastLoginAt: Date | null;
    isSelf: boolean;
    isPlatformAdmin: boolean;
  }

  const rows: Row[] = users.map((entry) => ({
    id: entry.id,
    code: entry.employeeCode,
    name: entry.name,
    email: entry.email,
    role: entry.role,
    branchId: entry.branchId,
    branch: entry.branch?.name ?? null,
    status: entry.status as "ACTIVE" | "SUSPENDED" | "INACTIVE",
    lastLoginAt: entry.lastLoginAt,
    isSelf: entry.id === user.id,
    isPlatformAdmin: entry.role === "PLATFORM_ADMIN",
  }));

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: "code",
      header: "Emp #",
      hideOnMobile: true,
      cell: (row) => <span className="numeric">{row.code ?? "—"}</span>,
    },
    {
      key: "role",
      header: "Role",
      cell: (row) => (
        <Badge tone="info">
          {ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role}
        </Badge>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      hideOnMobile: true,
      cell: (row) => row.branch ?? "—",
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={row.status}
          label={row.status.charAt(0) + row.status.slice(1).toLowerCase()}
          dot
        />
      ),
    },
    {
      key: "lastLogin",
      header: "Last login",
      hideOnMobile: true,
      cell: (row) => (
        <span className="numeric text-xs">
          {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Never"}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (row: Row) => (
              <div className="flex items-center justify-end gap-1.5">
                <EditUserButton
                  user={{
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    role: row.role,
                    branchId: row.branchId,
                    status: row.status,
                    isPlatformAdmin: row.isPlatformAdmin,
                    isSelf: row.isSelf,
                  }}
                  branches={branches}
                />
                <DeleteUserButton
                  userId={row.id}
                  userName={row.name}
                  userEmail={row.email}
                  isSelf={row.isSelf}
                  isPlatformAdmin={row.isPlatformAdmin}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description={`${rows.length} accounts — each signs in with a personal 6-digit access code`}
        actions={canManage ? <NewUserButton /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        renderMobileCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="truncate font-medium block">{row.name}</span>
                <p className="truncate text-xs text-muted-foreground">{row.email}</p>
              </div>
              <Badge tone="info">
                {ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? row.role}
              </Badge>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs text-muted-foreground">
              <span>
                {row.branch ?? "No Branch"} ·{" "}
                <StatusBadge
                  status={row.status}
                  label={row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                  dot
                />
              </span>
              {canManage && (
                <div className="flex items-center gap-1">
                  <EditUserButton
                    user={{
                      id: row.id,
                      name: row.name,
                      email: row.email,
                      role: row.role,
                      branchId: row.branchId,
                      status: row.status,
                      isPlatformAdmin: row.isPlatformAdmin,
                      isSelf: row.isSelf,
                    }}
                    branches={branches}
                  />
                  <DeleteUserButton
                    userId={row.id}
                    userName={row.name}
                    userEmail={row.email}
                    isSelf={row.isSelf}
                    isPlatformAdmin={row.isPlatformAdmin}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      />
    </div>
  );
}
