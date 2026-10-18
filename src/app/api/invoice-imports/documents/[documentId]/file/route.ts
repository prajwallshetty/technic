import { NextResponse } from "next/server";

import { errorStatus } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import { getDocumentFile } from "@/lib/services/invoice-imports";

/** Streams an uploaded source document to an authorised reviewer of the same firm. */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await authorize("invoice_import.view");
    const { documentId } = await params;
    const file = await getDocumentFile(requireFirmId(user), documentId);
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
        "Cache-Control": "private, no-store",
        // A sandbox CSP stops browsers' built-in PDF viewers from rendering,
        // so it is applied to images only; PDFs are framed same-origin only.
        ...(file.mimeType === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox" }),
        "X-Frame-Options": "SAMEORIGIN",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Not found" }, { status: errorStatus(error) === 500 ? 500 : 404 });
  }
}
