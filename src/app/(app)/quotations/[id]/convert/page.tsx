import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ConvertForm } from "./convert-form";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Convert quotation — Technic Technologies" };

export default async function ConvertQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionInFirm("quotation.convert");
  const { id } = await params;

  const quotation = await prisma.quotation.findFirst({
    where: { id, firmId: user.activeFirmId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      lines: true,
    },
  });
  if (!quotation) notFound();

  const isGst = quotation.taxMode === "GST";
  const hasDiscount = Number(quotation.discountAmount) > 0 || quotation.lines.some((l) => Number(l.discountPercent) > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={`Convert ${quotation.quotationNumber}`}
        description={`${quotation.customer.name} · ${formatDate(quotation.quotationDate)}`}
        backButton={<Button asChild variant="ghost" size="sm"><Link href="/quotations"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
      />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Item</TableHead>
                {isGst ? <TableHead className="hidden sm:table-cell">HSN</TableHead> : null}
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                {hasDiscount ? <TableHead className="text-right">Disc %</TableHead> : null}
                <TableHead className="pr-4 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotation.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="pl-4 font-medium">{line.description}</TableCell>
                  {isGst ? <TableCell className="hidden numeric sm:table-cell">{line.hsnCode || "—"}</TableCell> : null}
                  <TableCell className="text-right numeric">{line.quantity}</TableCell>
                  <TableCell className="text-right numeric">{formatCurrency(line.unitPrice)}</TableCell>
                  {hasDiscount ? (
                    <TableCell className="text-right numeric">
                      {Number(line.discountPercent) > 0 ? `${Number(line.discountPercent)}%` : "—"}
                    </TableCell>
                  ) : null}
                  <TableCell className="pr-4 text-right numeric font-medium">{formatCurrency(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="space-y-1.5 border-t border-border px-4 pt-3 text-sm font-medium">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items subtotal</span>
              <span className="numeric">{formatCurrency(quotation.subtotal)}</span>
            </div>
            {Number(quotation.discountAmount) > 0 ? (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <div>
                  <span>Bill discount</span>
                  {quotation.discountRemarks ? (
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                      ({quotation.discountRemarks})
                    </span>
                  ) : null}
                </div>
                <span className="numeric">-{formatCurrency(quotation.discountAmount)}</span>
              </div>
            ) : null}
            {isGst ? (
              <>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Taxable value</span>
                  <span className="numeric">{formatCurrency(quotation.taxableAmount)}</span>
                </div>
                {Number(quotation.cgstAmount) > 0 ? (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>CGST</span>
                    <span className="numeric">{formatCurrency(quotation.cgstAmount)}</span>
                  </div>
                ) : null}
                {Number(quotation.sgstAmount) > 0 ? (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>SGST</span>
                    <span className="numeric">{formatCurrency(quotation.sgstAmount)}</span>
                  </div>
                ) : null}
                {Number(quotation.igstAmount) > 0 ? (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>IGST</span>
                    <span className="numeric">{formatCurrency(quotation.igstAmount)}</span>
                  </div>
                ) : null}
              </>
            ) : null}
            {Number(quotation.roundOff) !== 0 ? (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Round off</span>
                <span className="numeric">
                  {Number(quotation.roundOff) > 0
                    ? `+${formatCurrency(quotation.roundOff)}`
                    : formatCurrency(quotation.roundOff)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
              <span>Quotation total</span>
              <span className="numeric">{formatCurrency(quotation.totalAmount)}</span>
            </div>
          </div>

          <div className="px-4 pt-2">
            <Badge tone={quotation.taxMode === "GST" ? "info" : "neutral"}>
              {quotation.taxMode === "GST" ? "Tax Invoice" : "Non-Tax Invoice"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <ConvertForm
        quotationId={quotation.id}
        customerId={quotation.customerId}
        total={Number(quotation.totalAmount)}
        canCollectPayment={user.permissions.includes("payments.create")}
      />
    </div>
  );
}
