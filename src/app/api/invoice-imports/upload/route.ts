import { after, NextResponse } from "next/server";

import { errorStatus, toActionResult } from "@/lib/action-result";
import { authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { createImportBatch, processQueuedDocuments } from "@/lib/services/invoice-imports";

/** Extraction of a large archive keeps running after the response is sent. */
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Bulk invoice upload (PDFs, images, ZIP archives). Excluded from the proxy
 * matcher because archives exceed its body buffer, so authentication and
 * authorisation happen here.
 */
export async function POST(request: Request) {
  try {
    const user = await authorize("invoice_import.manage");
    const firmId = requireFirmId(user);
    const branchId = await requireWriteBranch(user, null);

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `Upload is larger than ${MAX_UPLOAD_BYTES / 1048576} MB — split it into smaller archives` }, { status: 413 });
    }

    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
    const name = typeof form.get("name") === "string" ? (form.get("name") as string) : undefined;
    const uploads = await Promise.all(files.map(async (file) => ({ filename: file.name, data: Buffer.from(await file.arrayBuffer()) })));

    const result = await createImportBatch({ firmId, branchId, userId: user.id, name }, uploads);

    // Start extracting straight away; the batch page keeps the queue moving
    // if this is cut short.
    after(async () => {
      await processQueuedDocuments({ firmId, batchId: result.batchId, limit: 500, timeBudgetMs: 280_000 }).catch((error) =>
        console.error("[invoice-import] background processing failed", error),
      );
    });

    return NextResponse.json(result);
  } catch (error) {
    const result = toActionResult(error);
    return NextResponse.json({ error: result.ok ? "Unexpected" : result.error }, { status: errorStatus(error) });
  }
}
