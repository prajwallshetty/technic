import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, Printer, XCircle, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WhatsAppShareButton } from "@/components/shared/whatsapp-share-button";
import { CancelInvoiceButton } from "./cancel-invoice-button";
import { RecordInvoicePaymentButton } from "./record-payment-button";
import { SalesReturnButton } from "./sales-return-button";
import { DispatchDetailsButton } from "./dispatch-details-button";
import { getInvoiceForView } from "@/lib/services/sales";
import { requirePermissionInFirm, taxModeWhere } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/workflow";
import { NotFoundError } from "@/lib/action-result";

import { EditInvoiceButton } from "./edit-invoice-button";
import { DeleteInvoiceButton } from "../delete-invoice-button";

export const metadata = { title: "Invoice — Technic Technologies" };

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermissionInFirm("invoice.view");
  const { id } = await params;
  const sParams = searchParams ? await searchParams : {};

  let invoice;
  try {
    invoice = await getInvoiceForView(user.activeFirmId, id, { ...taxModeWhere(user) });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (invoice.firmId !== user.activeFirmId) notFound();

  const isTaxInvoice = invoice.kind === "TAX_INVOICE";
  const hasDiscount = Number(invoice.discountAmount) > 0 || invoice.lines.some((l) => Number(l.discountPercent) > 0);
  const canCancel = invoice.status !== "CANCELLED" && user.permissions.includes("invoice.cancel");
  const canReturn =
    invoice.status !== "CANCELLED" && user.permissions.includes("sales_return.create");
  const canRecordPayment =
    invoice.status !== "CANCELLED" &&
    Number(invoice.amountDue) > 0 &&
    user.permissions.includes("payments.create");
  const canEdit =
    invoice.status !== "CANCELLED" &&
    (user.permissions.includes("invoice.create") ||
      user.permissions.includes("sales.edit") ||
      user.permissions.includes("invoice.edit"));
  const canDelete =
    invoice.salesReturns.length === 0 &&
    (user.permissions.includes("invoice.delete") ||
      user.permissions.includes("sales.edit") ||
      user.permissions.includes("invoice.edit"));

  return (
    <div className="space-y-4">
      <PageHeader
        title={invoice.invoiceNumber}
        description={`${isTaxInvoice ? "Tax Invoice" : "Non-Tax Invoice"} · ${formatDate(invoice.invoiceDate)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/invoices"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/documents/invoice/${invoice.id}`} target="_blank" rel="noreferrer">
                <FileDown /> PDF
              </a>
            </Button>
            <WhatsAppShareButton
              documentId={invoice.id}
              documentType="invoice"
              documentNumber={invoice.invoiceNumber}
              customerPhone={invoice.billToPhone || undefined}
            />
            {canEdit ? (
              <EditInvoiceButton
                invoice={invoice}
                defaultOpen={sParams.edit === "true"}
              />
            ) : null}
            {canRecordPayment ? (
              <RecordInvoicePaymentButton invoiceId={invoice.id} amountDue={Number(invoice.amountDue)} />
            ) : null}
            {canReturn ? (
              <SalesReturnButton
                invoiceId={invoice.id}
                lines={invoice.lines.map((line) => ({
                  invoiceLineId: line.id,
                  description: line.description,
                  quantity: line.quantity,
                  returnedQty: line.returnedQty,
                  unitPrice: Number(line.unitPrice),
                  serialNumbers: line.serialNumbers ? line.serialNumbers.split("\n").filter(Boolean) : [],
                }))}
              />
            ) : null}
            {invoice.status !== "CANCELLED" && user.permissions.includes("invoice.create") ? (
              <DispatchDetailsButton
                invoiceId={invoice.id}
                initial={{
                  dispatchThrough: invoice.dispatchThrough ?? "",
                  vehicleNumber: invoice.vehicleNumber ?? "",
                  ewayBillNumber: invoice.ewayBillNumber ?? "",
                  buyerOrderNo: invoice.buyerOrderNo ?? "",
                }}
              />
            ) : null}
            {canCancel ? <CancelInvoiceButton invoiceId={invoice.id} /> : null}
            {canDelete ? (
              <DeleteInvoiceButton
                invoiceId={invoice.id}
                invoiceNumber={invoice.invoiceNumber}
                isCancelled={invoice.status === "CANCELLED"}
                redirectOnDelete
              />
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={invoice.status} label={INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status} dot />
        <StatusBadge
          status={invoice.taxMode}
          label={invoice.taxMode === "GST" ? "GST mode" : "Non-Tax"}
          tone={invoice.taxMode === "GST" ? "info" : "neutral"}
        />
        {invoice.status === "CANCELLED" && invoice.cancellationReason ? (
          <span className="text-sm text-destructive">Reason: {invoice.cancellationReason}</span>
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
                    {isTaxInvoice ? <TableHead className="hidden sm:table-cell">HSN</TableHead> : null}
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    {hasDiscount ? <TableHead className="text-right">Disc %</TableHead> : null}
                    {isTaxInvoice ? <TableHead className="hidden text-right sm:table-cell">Taxable</TableHead> : null}
                    {isTaxInvoice ? <TableHead className="hidden text-right sm:table-cell">GST</TableHead> : null}
                    <TableHead className="pr-4 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lines.map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell className="pl-4 numeric">{index + 1}</TableCell>
                      <TableCell>
                        <p className="font-medium">{line.description}</p>
                        {line.product?.subName ? <p className="text-xs text-muted-foreground">{line.product.subName}</p> : null}
                        {line.serialNumbers ? (
                          <p className="text-xs text-muted-foreground">SN: {line.serialNumbers.split("\n").join(", ")}</p>
                        ) : null}
                      </TableCell>
                      {isTaxInvoice ? (
                        <TableCell className="hidden numeric sm:table-cell">{line.hsnCode || "—"}</TableCell>
                      ) : null}
                      <TableCell className="text-right numeric">{line.quantity}</TableCell>
                      <TableCell className="text-right numeric">{formatCurrency(line.unitPrice)}</TableCell>
                      {hasDiscount ? (
                        <TableCell className="text-right numeric">
                          {Number(line.discountPercent) > 0 ? `${Number(line.discountPercent)}%` : "—"}
                        </TableCell>
                      ) : null}
                      {isTaxInvoice ? (
                        <TableCell className="hidden text-right numeric sm:table-cell">
                          {formatCurrency(line.taxableValue)}
                        </TableCell>
                      ) : null}
                      {isTaxInvoice ? (
                        <TableCell className="hidden text-right numeric sm:table-cell">
                          {formatCurrency(
                            Number(line.cgstAmount) + Number(line.sgstAmount) + Number(line.igstAmount),
                          )}
                        </TableCell>
                      ) : null}
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
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="numeric">{formatCurrency(invoice.subtotal)}</span></div>
              {Number(invoice.discountAmount) > 0 ? (
                <div className="flex justify-between">
                  <div>
                    <span className="text-muted-foreground">Discount</span>
                    {invoice.discountRemarks ? (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        ({invoice.discountRemarks})
                      </span>
                    ) : null}
                  </div>
                  <span className="numeric">-{formatCurrency(invoice.discountAmount)}</span>
                </div>
              ) : null}
              {isTaxInvoice ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Taxable value</span><span className="numeric">{formatCurrency(invoice.taxableAmount)}</span></div>
                  {Number(invoice.cgstAmount) > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="numeric">{formatCurrency(invoice.cgstAmount)}</span></div> : null}
                  {Number(invoice.sgstAmount) > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="numeric">{formatCurrency(invoice.sgstAmount)}</span></div> : null}
                  {Number(invoice.igstAmount) > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="numeric">{formatCurrency(invoice.igstAmount)}</span></div> : null}
                  {Number(invoice.roundOff) !== 0 ? <div className="flex justify-between"><span className="text-muted-foreground">Round off</span><span className="numeric">{formatCurrency(invoice.roundOff)}</span></div> : null}
                </>
              ) : null}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span><span className="numeric">{formatCurrency(invoice.totalAmount)}</span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="numeric">{formatCurrency(invoice.amountPaid)}</span></div>
              <div className="flex justify-between font-medium"><span className="text-muted-foreground">Balance due</span><span className="numeric">{formatCurrency(invoice.amountDue)}</span></div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Bill to</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{invoice.billToName}</p>
              {invoice.billToPhone ? <p className="text-muted-foreground">{invoice.billToPhone}</p> : null}
              {invoice.billToAddress ? <p className="text-muted-foreground">{invoice.billToAddress}</p> : null}
              {invoice.billToGstin ? <p className="text-muted-foreground">GSTIN: {invoice.billToGstin}</p> : null}
              <p className="text-muted-foreground">Place of supply: {invoice.placeOfSupply || "—"}</p>
              <p className="pt-1">
                <Link href={`/customers/${invoice.customerId}`} className="text-primary hover:underline">
                  View customer →
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {invoice.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                invoice.payments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(payment.paidAt)}</p>
                    </div>
                    <span className="numeric font-semibold">{formatCurrency(payment.amount)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">References</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              {invoice.quotation ? <p>Quotation: {invoice.quotation.quotationNumber}</p> : null}
              {invoice.salesOrder ? <p>Sales order: {invoice.salesOrder.orderNumber}</p> : null}
              {invoice.createdBy ? <p>Issued by {invoice.createdBy.name}</p> : null}
              <p>Financial year {invoice.financialYear}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
