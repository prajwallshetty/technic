import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { NotFoundError } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import type { ExtractedInvoice, Field } from "@/lib/invoice-import/types";
import { ACKNOWLEDGEABLE_CODES, getDocumentForReview } from "@/lib/services/invoice-imports";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Review imported invoice — Technic Technologies" };

export default async function ReviewImportedInvoicePage({ params }: { params: Promise<{ documentId: string }> }) {
  const user = await requirePermissionInFirm("invoice_import.view");
  const { documentId } = await params;

  let doc;
  try {
    doc = await getDocumentForReview(user.activeFirmId, documentId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [catalogue, suppliers] = await Promise.all([
    prisma.product.findMany({
      where: { firmId: user.activeFirmId, status: "ACTIVE" },
      select: { id: true, sku: true, name: true },
      orderBy: { name: "asc" },
      take: 5000,
    }),
    doc.direction === "PURCHASE"
      ? prisma.supplier.findMany({
          where: { firmId: user.activeFirmId, isActive: true },
          select: { id: true, name: true, gstin: true },
          orderBy: { name: "asc" },
          take: 2000,
        })
      : Promise.resolve([]),
  ]);

  const editable = ["READY", "NEEDS_REVIEW", "DUPLICATE"].includes(doc.status);
  const canEdit = editable && user.permissions.includes("invoice_import.manage");
  const canApprove = editable && user.permissions.includes("invoice_import.approve");

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc.sourceFilename}
        description={[
          doc.direction === "SALES" ? "Sales invoice issued by this firm" : doc.direction === "PURCHASE" ? "Supplier (purchase) invoice" : "Direction unknown",
          doc.extractionMethod === "OCR" ? "read by OCR" : doc.extractionMethod === "PDF_TEXT" ? "read from the PDF text layer" : null,
          doc.pageCount ? `${doc.pageCount} page(s)` : null,
          doc.sourcePath !== doc.sourceFilename ? doc.sourcePath : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        backButton={
          <Link href={`/invoice-imports/${doc.batch.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {doc.batch.name}
          </Link>
        }
        actions={<StatusBadge status={doc.status} dot />}
      />

      {doc.status === "FAILED" ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Extraction failed after {doc.attempts} attempt(s): {doc.lastError}
        </div>
      ) : null}
      {doc.status === "REJECTED" ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">Rejected: {doc.rejectionReason}</div>
      ) : null}
      {doc.status === "POSTED" && doc.postedEntity === "PurchaseOrder" ? (
        <div className="rounded-lg border border-success/40 bg-success/5 px-4 py-3 text-sm">
          A draft purchase order was created.{" "}
          <Link href={`/purchases/${doc.postedEntityId}`} className="font-medium text-primary hover:underline">
            Open it
          </Link>{" "}
          and receive the goods there to update stock.
        </div>
      ) : null}
      {doc.status === "APPROVED" && doc.direction === "SALES" ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          Approved as a reviewed record. No ERP invoice was created — issuing one through billing would deduct stock and raise a receivable.
        </div>
      ) : null}

      <ReviewForm
        documentId={doc.id}
        status={doc.status}
        fileUrl={`/api/invoice-imports/documents/${doc.id}/file`}
        mimeType={doc.mimeType}
        draft={doc.draft}
        evaluation={doc.evaluation}
        confidence={confidenceMap(doc.extraction as ExtractedInvoice | null)}
        assignments={doc.assignments}
        acknowledgements={doc.acknowledgements}
        catalogue={catalogue}
        suppliers={suppliers}
        acknowledgeable={[...ACKNOWLEDGEABLE_CODES]}
        canEdit={canEdit}
        canApprove={canApprove}
        canReprocess={user.permissions.includes("invoice_import.manage") && ["FAILED", "NEEDS_REVIEW", "READY", "DUPLICATE"].includes(doc.status)}
      />
    </div>
  );
}

/** Flattens the extraction's per-field confidence into "path → 0..1" for the form. */
function confidenceMap(extraction: ExtractedInvoice | null): Record<string, number> {
  if (!extraction) return {};
  const out: Record<string, number> = {};
  const put = (key: string, f: Field<unknown> | undefined) => {
    if (f) out[key] = f.confidence;
  };
  const party = extraction.direction === "PURCHASE" ? extraction.issuer : extraction.recipient;
  put("invoiceNumber", extraction.invoiceNumber);
  put("invoiceDate", extraction.invoiceDate);
  put("paymentTerms", extraction.paymentTerms);
  put("purchaseOrderNumber", extraction.purchaseOrderNumber);
  put("currency", extraction.currency);
  put("documentType", extraction.documentType);
  put("partyName", party?.name);
  put("partyGstin", party?.gstin);
  put("partyPhone", party?.phone);
  for (const [key, f] of Object.entries(extraction.totals ?? {})) {
    if (f && typeof f === "object" && "confidence" in f) put(`totals.${key}`, f as Field<unknown>);
  }
  for (const line of extraction.lines ?? []) {
    for (const key of ["description", "hsn", "quantity", "unit", "rate", "gstRate", "amount"] as const) {
      put(`lines.${line.lineNo}.${key}`, line[key] as Field<unknown>);
    }
  }
  return out;
}
