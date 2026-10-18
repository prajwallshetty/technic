import type { DocumentText, PageText, TextItem } from "./types";

// pdf-parse's index.js runs a debug self-test when required without a parent
// module, so the library entry is imported directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: PdfParseFn = require("pdf-parse/lib/pdf-parse.js");

type PdfParseFn = (
  data: Buffer,
  options: { pagerender: (page: PdfPage) => Promise<string>; max?: number },
) => Promise<{ numpages: number }>;

interface PdfPage {
  pageIndex: number;
  view: number[];
  getTextContent(options?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<{
    items: Array<{ str: string; transform: number[]; width: number; height: number }>;
  }>;
}

export class DocumentReadError extends Error {
  constructor(
    message: string,
    readonly code: "PASSWORD_PROTECTED" | "CORRUPTED" | "UNSUPPORTED",
  ) {
    super(message);
    this.name = "DocumentReadError";
  }
}

/** Minimum printable characters per page for a page to count as "digital". */
const MIN_TEXT_CHARS_PER_PAGE = 40;

/**
 * Reads the PDF text layer with coordinates. Scanned PDFs come back with
 * `hasTextLayer: false` so the caller can route them to OCR instead of
 * pretending an empty page was parsed.
 */
export async function extractPdfText(buffer: Buffer): Promise<DocumentText & { hasTextLayer: boolean }> {
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new DocumentReadError("File is not a PDF (missing %PDF- header)", "UNSUPPORTED");
  }

  const pages: PageText[] = [];
  let pageCount = 0;
  try {
    const result = await pdfParse(buffer, {
      pagerender: async (page) => {
        const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
        const pageNo = page.pageIndex + 1;
        const items: TextItem[] = content.items
          .map((item) => ({
            str: item.str,
            x: round1(item.transform[4]),
            y: round1(item.transform[5]),
            width: round1(item.width),
            height: round1(item.height || Math.abs(item.transform[3])),
            page: pageNo,
          }))
          .filter((item) => item.str.trim().length > 0);
        const [x0 = 0, y0 = 0, x1 = 612, y1 = 792] = page.view ?? [];
        pages.push({ page: pageNo, width: x1 - x0, height: y1 - y0, items });
        return "";
      },
    });
    pageCount = result.numpages;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = (error as { name?: string })?.name ?? "";
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new DocumentReadError("PDF is password-protected", "PASSWORD_PROTECTED");
    }
    throw new DocumentReadError(`PDF could not be parsed: ${message}`, "CORRUPTED");
  }

  pages.sort((a, b) => a.page - b.page);
  const plainText = pages.map((page) => linesToText(groupLines(page.items))).join("\n\f\n");
  const hasTextLayer =
    pages.length > 0 &&
    pages.every((page) => page.items.reduce((n, item) => n + item.str.trim().length, 0) >= MIN_TEXT_CHARS_PER_PAGE);

  return { method: "PDF_TEXT", pageCount: pageCount || pages.length, pages, plainText, hasTextLayer };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export interface TextLine {
  y: number;
  page: number;
  items: TextItem[];
  text: string;
}

/** Groups items into visual rows (top to bottom), each row sorted left to right. */
export function groupLines(items: TextItem[], tolerance = 2.5): TextLine[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const item of sorted) {
    const line = lines.find((l) => l.page === item.page && Math.abs(l.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, page: item.page, items: [item], text: "" });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((i) => i.str.trim()).join(" ");
  }
  return lines.sort((a, b) => a.page - b.page || b.y - a.y);
}

function linesToText(lines: TextLine[]): string {
  return lines.map((line) => line.text).join("\n");
}
