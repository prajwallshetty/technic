import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WhatsAppShareButton } from "@/components/shared/whatsapp-share-button";
import { getSalesOrderForView } from "@/lib/services/sales";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SALES_ORDER_STATUS_LABELS } from "@/lib/workflow";
import { NotFoundError } from "@/lib/action-result";

export const metadata = { title: "Sales Order — Technic Technologies" };

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("sales.view");
  const { id } = await params;

  let order;
  try {
    order = await getSalesOrderForView(user.activeFirmId, id, { ...taxModeWhere(user) });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (order.firmId !== user.activeFirmId) notFound();

  const isGst = order.taxMode === "GST";

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.orderNumber}
        description={`Sales Order · ${formatDate(order.orderDate)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/sales-orders"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/documents/purchase-order/${order.id}`} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            <WhatsAppShareButton
              documentId={order.id}
              documentType="purchase-order"
              documentNumber={order.orderNumber}
              customerPhone={order.customer.phone}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={order.status} label={SALES_ORDER_STATUS_LABELS[order.status] ?? order.status} dot />
        <StatusBadge
          status={order.taxMode}
          label={order.taxMode === "GST" ? "GST mode" : "Non-Tax"}
          tone={order.taxMode === "GST" ? "info" : "neutral"}
        />
        {order.expectedDate ? (
          <span className="text-sm text-muted-foreground">Expected: {formatDate(order.expectedDate)}</span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Items</CardTitle>
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
                  {order.lines.map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell className="pl-4 numeric">{index + 1}</TableCell>
                      <TableCell>
                        <p className="font-medium">{line.description}</p>
                      </TableCell>
                      {isGst ? (
                        <TableCell className="hidden numeric sm:table-cell">{line.hsnCode || "—"}</TableCell>
                      ) : null}
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
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="numeric">{formatCurrency(order.subtotal)}</span></div>
              {Number(order.discountAmount) > 0 ? (
                <div className="flex justify-between">
                  <div>
                    <span className="text-muted-foreground">Discount</span>
                    {order.discountRemarks ? (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        ({order.discountRemarks})
                      </span>
                    ) : null}
                  </div>
                  <span className="numeric">-{formatCurrency(order.discountAmount)}</span>
                </div>
              ) : null}
              {isGst ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Taxable value</span><span className="numeric">{formatCurrency(order.taxableAmount)}</span></div>
                  {Number(order.cgstAmount) > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="numeric">{formatCurrency(order.cgstAmount)}</span></div> : null}
                  {Number(order.sgstAmount) > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="numeric">{formatCurrency(order.sgstAmount)}</span></div> : null}
                  {Number(order.igstAmount) > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="numeric">{formatCurrency(order.igstAmount)}</span></div> : null}
                </>
              ) : null}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span><span className="numeric">{formatCurrency(order.totalAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Customer</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{order.customer.name}</p>
              {order.customer.phone ? <p className="text-muted-foreground">{order.customer.phone}</p> : null}
              {order.customer.gstin ? <p className="text-muted-foreground">GSTIN: {order.customer.gstin}</p> : null}
              <p className="pt-1">
                <Link href={`/customers/${order.customerId}`} className="text-primary hover:underline">
                  View customer →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Branch: {order.branch.name}</p>
              {order.quotation ? <p>Quotation: {order.quotation.quotationNumber}</p> : null}
              <p>Created by: {order.createdBy?.name || "—"}</p>
            </CardContent>
          </Card>

          {order.notes ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent className="text-sm">{order.notes}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
