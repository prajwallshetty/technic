import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { DocumentText, PageText, TextItem } from "./types";

const run = promisify(execFile);

/**
 * OCR adapter for scanned PDFs and photographed invoices.
 *
 * Uses the Tesseract CLI (word boxes via TSV output) and, for PDFs, Poppler's
 * `pdftoppm` to rasterise pages. Both are external binaries configured with
 * OCR_TESSERACT_CMD / OCR_PDFTOPPM_CMD. When they are not installed the
 * document fails with OcrUnavailableError — it is never reported as parsed.
 *
 * Word boxes are converted to PDF points with the origin at the bottom-left so
 * OCR output feeds the same positional layout parsers as digital PDFs.
 */

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrUnavailableError";
  }
}

const DPI = 300;
const PX_TO_PT = 72 / DPI;

function tesseractCmd() {
  return process.env.OCR_TESSERACT_CMD || "tesseract";
}
function pdftoppmCmd() {
  return process.env.OCR_PDFTOPPM_CMD || "pdftoppm";
}

async function binaryAvailable(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export async function ocrAvailability(): Promise<{ tesseract: boolean; pdftoppm: boolean }> {
  const [tesseract, pdftoppm] = await Promise.all([
    binaryAvailable(tesseractCmd(), ["--version"]),
    binaryAvailable(pdftoppmCmd(), ["-v"]),
  ]);
  return { tesseract, pdftoppm };
}

export async function ocrDocument(buffer: Buffer, mimeType: string): Promise<DocumentText> {
  const { tesseract, pdftoppm } = await ocrAvailability();
  const isPdf = mimeType === "application/pdf";
  if (!tesseract) {
    throw new OcrUnavailableError(
      "Document has no text layer and needs OCR, but Tesseract is not installed on the server (set OCR_TESSERACT_CMD).",
    );
  }
  if (isPdf && !pdftoppm) {
    throw new OcrUnavailableError(
      "Scanned PDF needs page rasterisation for OCR, but pdftoppm (Poppler) is not installed (set OCR_PDFTOPPM_CMD).",
    );
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "inv-ocr-"));
  try {
    const images: string[] = [];
    if (isPdf) {
      const pdfPath = path.join(workDir, "input.pdf");
      await fs.writeFile(pdfPath, buffer);
      await run(pdftoppmCmd(), ["-r", String(DPI), "-png", pdfPath, path.join(workDir, "page")], {
        timeout: 120_000,
      });
      const files = (await fs.readdir(workDir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
      images.push(...files.map((f) => path.join(workDir, f)));
    } else {
      const ext = mimeType === "image/png" ? ".png" : mimeType === "image/tiff" ? ".tif" : ".jpg";
      const imagePath = path.join(workDir, `input${ext}`);
      await fs.writeFile(imagePath, buffer);
      images.push(imagePath);
    }

    const pages: PageText[] = [];
    for (const [index, image] of images.entries()) {
      const { stdout } = await run(tesseractCmd(), [image, "stdout", "--psm", "6", "-l", "eng", "tsv"], {
        timeout: 180_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      pages.push(parseTesseractTsv(stdout, index + 1));
    }

    const plainText = pages
      .map((page) => {
        const rows = new Map<number, TextItem[]>();
        for (const item of page.items) {
          const key = Math.round(item.y / 4);
          rows.set(key, [...(rows.get(key) ?? []), item]);
        }
        return [...rows.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" "))
          .join("\n");
      })
      .join("\n\f\n");

    return { method: "OCR", pageCount: pages.length, pages, plainText };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/** Converts Tesseract TSV (level 5 = word) into positioned items in PDF points. */
export function parseTesseractTsv(tsv: string, pageNo: number): PageText {
  const rows = tsv.split(/\r?\n/).slice(1).map((line) => line.split("\t"));
  let pageHeightPx = 0;
  let pageWidthPx = 0;
  const words: Array<{ text: string; left: number; top: number; width: number; height: number; conf: number }> = [];
  for (const cols of rows) {
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    const [left, top, width, height] = cols.slice(6, 10).map(Number);
    if (level === 1) {
      pageWidthPx = width;
      pageHeightPx = height;
    }
    if (level === 5 && cols[11]?.trim()) {
      words.push({ text: cols[11], left, top, width, height, conf: Number(cols[10]) });
    }
  }
  const heightPt = pageHeightPx * PX_TO_PT;
  const items: TextItem[] = words.map((w) => ({
    str: w.text,
    x: w.left * PX_TO_PT,
    y: heightPt - (w.top + w.height) * PX_TO_PT,
    width: w.width * PX_TO_PT,
    height: w.height * PX_TO_PT,
    page: pageNo,
  }));
  return { page: pageNo, width: pageWidthPx * PX_TO_PT, height: heightPt, items };
}
