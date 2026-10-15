import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortHeader } from "@/components/shared/table-controls";
import { cn } from "@/lib/utils";

export interface Column<T> {
  /** Stable key — also used as the React key for the cell. */
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** Hidden below the `sm` breakpoint to keep mobile tables readable. */
  hideOnMobile?: boolean;
  /** Sorts on this field when set; the header becomes a sort toggle. */
  sortKey?: string;
  /** Offered in the column picker. Columns without a label are always shown. */
  toggleLabel?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  /** Column keys the reader has switched off, from the `hide` query param. */
  hiddenColumns?: string[];
  /** Optional mobile-optimized card layout renderer. On small screens (< md), this card view is rendered instead of a squished table. */
  renderMobileCard?: (row: T, index: number) => ReactNode;
}

/** Splits the `hide` query param into the set DataTable expects. */
export function hiddenColumnsFrom(value: string | undefined): string[] {
  return (value ?? "").split(",").filter(Boolean);
}

/** The columns worth offering in the picker, in table order. */
export function toggleableColumns<T>(
  columns: Column<T>[],
): Array<{ key: string; label: string }> {
  return columns
    .filter((column) => column.toggleLabel)
    .map((column) => ({ key: column.key, label: column.toggleLabel! }));
}

/**
 * Server-renderable table. Cells are supplied as render functions so pages can
 * compose links, badges and actions without shipping table logic to the client.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  empty,
  className,
  rowClassName,
  hiddenColumns = [],
  renderMobileCard,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    if (empty) return <>{empty}</>;
    const hidden = new Set(hiddenColumns);
    const visible = columns.filter((column) => !hidden.has(column.key));
    return (
      <div className={cn("overflow-x-auto rounded-xl border border-border bg-card", className)}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {visible.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.hideOnMobile && "hidden sm:table-cell",
                    column.headerClassName,
                  )}
                >
                  {column.sortKey ? (
                    <SortHeader
                      sortKey={column.sortKey}
                      label={column.header}
                      align={column.headerClassName?.includes("text-right") ? "right" : "left"}
                    />
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={visible.length || 1} className="h-32 text-center text-muted-foreground text-sm">
                No records found.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  const hidden = new Set(hiddenColumns);
  const visible = columns.filter((column) => !hidden.has(column.key));

  return (
    <div className="space-y-4">
      {renderMobileCard ? (
        <div className="space-y-3 md:hidden">
          {rows.map((row, index) => (
            <div
              key={getRowKey(row, index)}
              className={cn(
                "rounded-xl border border-border bg-card p-3.5 shadow-sm space-y-2.5 transition-all hover:border-primary/40",
                rowClassName?.(row),
              )}
            >
              {renderMobileCard(row, index)}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "overflow-x-auto rounded-xl border border-border bg-card scrollbar-thin",
          renderMobileCard ? "hidden md:block" : "block",
          className,
        )}
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {visible.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.hideOnMobile && "hidden sm:table-cell",
                    column.headerClassName,
                  )}
                >
                  {column.sortKey ? (
                    <SortHeader
                      sortKey={column.sortKey}
                      label={column.header}
                      align={column.headerClassName?.includes("text-right") ? "right" : "left"}
                    />
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow
                key={getRowKey(row, index)}
                className={cn("group/row", rowClassName?.(row))}
              >
                {visible.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      column.hideOnMobile && "hidden sm:table-cell",
                      column.className,
                    )}
                  >
                    {column.cell(row, index)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
