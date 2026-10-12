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
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="pr-4 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotation.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="pl-4 font-medium">{line.description}</TableCell>
                  <TableCell className="text-right numeric">{line.quantity}</TableCell>
                  <TableCell className="text-right numeric">{formatCurrency(line.unitPrice)}</TableCell>
                  <TableCell className="pr-4 text-right numeric">{formatCurrency(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between border-t border-border px-4 pt-3 text-base font-semibold">
            <span>Quotation total</span>
            <span className="numeric">{formatCurrency(quotation.totalAmount)}</span>
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
