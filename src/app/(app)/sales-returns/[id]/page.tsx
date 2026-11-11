import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSalesReturnForView } from "@/lib/services/payments";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SALES_RETURN_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/workflow";
import { NotFoundError } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";
import { CreateCreditNoteButton } from "./create-credit-note-button";

export const metadata = { title: "Sales Return — Technic Technologies" };

export default async function SalesReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("sales.view");
  const { id } = await params;

  let salesReturn;
  try {
    salesReturn = await getSalesReturnForView(user.activeFirmId, id, { ...taxModeWhere(user) });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (salesReturn.firmId !== user.activeFirmId) notFound();

  const isGst = salesReturn.taxMode === "GST";
  const creditNote = await prisma.creditDebitNote.findFirst({ where: { salesReturnId: salesReturn.id }, select: { id: true, noteNumber: true } });
  const canApprove = salesReturn.status === "PENDING" && (user.permissions.includes("sales.cancel") || user.permissions.includes("invoice.cancel"));

  return (
    <div className="space-y-4">
      <PageHeader
        title={salesReturn.returnNumber}
        description={`Sales Return · ${formatDate(salesReturn.createdAt)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/sales-returns"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            {canApprove ? (
              <Button asChild>
                <Link href={`/sales-returns`}>Approve Return</Link>
              </Button>
            ) : null}
            {salesReturn.status === "APPROVED" && isGst && user.permissions.includes("invoice.create") ? (
              creditNote ? (
                <Button asChild variant="outline"><Link href={`/credit-notes/${creditNote.id}`}>Credit note {creditNote.noteNumber}</Link></Button>
              ) : (
                <CreateCreditNoteButton salesReturnId={salesReturn.id} />
              )
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={salesReturn.status} label={SALES_RETURN_STATUS_LABELS[salesReturn.status] ?? salesReturn.status} dot />
        <Badge>{PAYMENT_METHOD_LABELS[salesReturn.refundMethod] ?? salesReturn.refundMethod}</Badge>
        {isGst ? <Badge tone="info">GST mode</Badge> : <Badge tone="neutral">Non-Tax</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Returned Items</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">#</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="pr-4 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesReturn.lines.map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell className="pl-4 numeric">{index + 1}</TableCell>
                      <TableCell>
                        <p className="font-medium">{line.description}</p>
                        {line.serialNumbers ? (
                          <p className="text-xs text-muted-foreground">SN: {line.serialNumbers.split("\n").join(", ")}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right numeric">{line.quantity}</TableCell>
                      <TableCell className="text-right numeric">{formatCurrency(line.unitPrice)}</TableCell>
                      <TableCell className="pr-4 text-right numeric font-medium">
                        {formatCurrency(line.lineTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Separator className="my-4" />

            <div className="space-y-1.5 px-4 text-sm">
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total Refund</span><span className="numeric">{formatCurrency(salesReturn.totalAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Customer</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{salesReturn.customer.name}</p>
              {salesReturn.customer.phone ? <p className="text-muted-foreground">{salesReturn.customer.phone}</p> : null}
              {salesReturn.customer.gstin ? <p className="text-muted-foreground">GSTIN: {salesReturn.customer.gstin}</p> : null}
              <p className="pt-1">
                <Link href={`/customers/${salesReturn.customerId}`} className="text-primary hover:underline">
                  View customer →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Invoice Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Link href={`/invoices/${salesReturn.invoiceId}`} className="text-primary hover:underline">
                {salesReturn.invoice.invoiceNumber}
              </Link>
              <p className="text-muted-foreground">{salesReturn.invoice.customer?.name}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Return Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Branch: {salesReturn.branch.name}</p>
              <p>Reason: {salesReturn.reason}</p>
              <p>Created by: {salesReturn.createdBy?.name || "—"}</p>
              {salesReturn.approvedBy ? <p>Approved by: {salesReturn.approvedBy.name}</p> : null}
              {salesReturn.approvedAt ? <p>Approved at: {formatDate(salesReturn.approvedAt)}</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
