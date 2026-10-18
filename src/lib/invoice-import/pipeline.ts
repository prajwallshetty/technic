import { draftFromExtraction, type DraftInvoice } from "./draft";
import { partyKeyFor, type MatchResult, type ProductMatcher } from "./matching";
import { ocrDocument } from "./ocr";
import { parseInvoice } from "./parse-invoice";
import { extractPdfText } from "./pdf-text";
import { reconcile, type ReconciliationResult } from "./reconcile";
import type { DocumentText, ExtractedInvoice, ExtractionIssue } from "./types";

export const SUPPORTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/tiff"] as const;

export interface ExtractOptions {
  sourceFilename: string;
  mimeType: string;
  firmGstin: string | null;
}

export interface ExtractionOutput {
  text: DocumentText;
  extraction: ExtractedInvoice;
  draft: DraftInvoice;
}

/** Reads the document (text layer, or OCR when there is none) and parses it. */
export async function extractDocument(data: Buffer, options: ExtractOptions): Promise<ExtractionOutput> {
  let text: DocumentText;
  if (options.mimeType === "application/pdf") {
    const pdf = await extractPdfText(data);
    text = pdf.hasTextLayer ? pdf : await ocrDocument(data, options.mimeType);
  } else if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(options.mimeType)) {
    text = await ocrDocument(data, options.mimeType);
  } else {
    throw new Error(`Unsupported file type ${options.mimeType}`);
  }
  const extraction = parseInvoice(text, { sourceFilename: options.sourceFilename, firmGstin: options.firmGstin });
  if (text.method === "OCR") {
    // OCR'd characters are never as trustworthy as a text layer.
    extraction.issues.push({
      code: "OCR_USED",
      severity: "WARNING",
      message: "Read by OCR — verify every figure against the image",
    });
  }
  return { text, extraction, draft: draftFromExtraction(extraction) };
}

export interface LineAssignment {
  productId: string;
  method: "MANUAL";
}

export interface EvaluationOptions {
  firmGstin: string | null;
  matcher: ProductMatcher | null;
  /** Reviewer-confirmed products by line number; these are never re-matched. */
  assignments?: Map<number, LineAssignment>;
  today?: string;
}

export interface Evaluation {
  reconciliation: ReconciliationResult;
  matches: Array<{ lineNo: number; match: MatchResult }>;
  issues: ExtractionIssue[];
  confidence: number;
  summary: {
    itemLines: number;
    adjustmentLines: number;
    matched: number;
    suggested: number;
    unmatched: number;
    errors: number;
    warnings: number;
  };
}

/** Validates and matches a draft. Pure: the same draft always evaluates the same way. */
export function evaluateDraft(draft: DraftInvoice, options: EvaluationOptions, extractionIssues: ExtractionIssue[] = []): Evaluation {
  const reconciliation = reconcile(draft, { firmGstin: options.firmGstin, today: options.today });
  const partyKey = partyKeyFor(draft.partyGstin, draft.partyName);
  const issues: ExtractionIssue[] = [...extractionIssues, ...reconciliation.issues];

  const matches = draft.lines.map((line) => {
    const assigned = options.assignments?.get(line.lineNo);
    if (assigned && line.kind === "ITEM") {
      return {
        lineNo: line.lineNo,
        match: { status: "MATCHED", productId: assigned.productId, method: "MANUAL", confidence: 1, candidates: [] } as MatchResult,
      };
    }
    const match: MatchResult = options.matcher
      ? options.matcher.match({ kind: line.kind, description: line.description, sku: line.sku, barcode: line.barcode, partyKey })
      : line.kind === "ADJUSTMENT"
        ? { status: "NOT_APPLICABLE", productId: null, method: null, confidence: 1, candidates: [] }
        : { status: "UNMATCHED", productId: null, method: null, confidence: 0, candidates: [], note: "No catalogue loaded" };
    return { lineNo: line.lineNo, match };
  });

  for (const { lineNo, match } of matches) {
    if (match.status === "MATCHED" || match.status === "NOT_APPLICABLE") continue;
    issues.push({
      code: match.status === "SUGGESTED" ? "PRODUCT_NEEDS_CONFIRMATION" : match.status === "AMBIGUOUS" ? "PRODUCT_AMBIGUOUS" : "PRODUCT_NOT_FOUND",
      severity: "ERROR",
      message:
        match.status === "SUGGESTED"
          ? `Line ${lineNo}: suggested ${match.candidates[0]?.name} (${Math.round(match.confidence * 100)}%) — confirm or choose another product`
          : match.status === "AMBIGUOUS"
            ? `Line ${lineNo}: ${match.note}`
            : `Line ${lineNo}: no matching catalogue product`,
      field: `lines.${lineNo}.product`,
    });
  }

  const itemLines = draft.lines.filter((l) => l.kind === "ITEM").length;
  const count = (s: MatchResult["status"]) => matches.filter((m) => m.match.status === s).length;
  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;

  return {
    reconciliation,
    matches,
    issues,
    confidence: documentConfidence(draft, reconciliation, errors, warnings),
    summary: {
      itemLines,
      adjustmentLines: draft.lines.length - itemLines,
      matched: count("MATCHED"),
      suggested: count("SUGGESTED") + count("AMBIGUOUS"),
      unmatched: count("UNMATCHED"),
      errors,
      warnings,
    },
  };
}

/**
 * A single 0–1 indicator for the list view. It is deliberately simple and
 * explainable: start from 1, and drop for every check that failed or could
 * not be made. It is not an accuracy estimate.
 */
function documentConfidence(draft: DraftInvoice, rec: ReconciliationResult, errors: number, warnings: number): number {
  let score = 1;
  for (const value of [draft.invoiceNumber, draft.invoiceDate, draft.partyName, draft.totals.grandTotal]) {
    if (value === null || value === "") score -= 0.15;
  }
  const evaluated = rec.checks.filter((c) => c.ok !== null);
  const failed = evaluated.filter((c) => c.ok === false).length;
  if (evaluated.length === 0) score -= 0.3;
  score -= failed * 0.1;
  if (!rec.calculated.complete) score -= 0.1;
  score -= Math.min(0.2, errors * 0.03) + Math.min(0.1, warnings * 0.01);
  return Math.max(0, Math.round(score * 100) / 100);
}
