import fs from "node:fs";

/**
 * RFC 4180 compliant CSV parser with zero external dependencies.
 * Handles:
 * - UTF-8 Byte Order Mark (\ufeff)
 * - Quoted fields containing commas, escaped quotes (""), and newlines
 * - Trimmed headers and values
 * - Windows (\r\n) and Unix (\n) line endings
 */
export function parseCsv<T = Record<string, string>>(csvContent: string): T[] {
  // Strip UTF-8 BOM if present
  let content = csvContent;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;
  const len = content.length;

  while (i < len) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        // Lookahead for escaped quote ("")
        if (i + 1 < len && content[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (char === "\r") {
        // Handle CRLF
        if (i + 1 < len && content[i + 1] === "\n") {
          i++;
        }
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Push trailing field/row if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Filter out empty rows
  const cleanRows = rows.filter((r) => r.length > 0 && r.some((c) => c.trim().length > 0));
  if (cleanRows.length === 0) return [];

  // Header row
  const rawHeaders = cleanRows[0];
  const headers = rawHeaders.map((h) => h.trim().replace(/^[\ufeff"]+|["\s]+$/g, ""));

  const records: T[] = [];
  for (let r = 1; r < cleanRows.length; r++) {
    const rowValues = cleanRows[r];
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      const val = c < rowValues.length ? rowValues[c].trim() : "";
      record[header] = val;
    }
    records.push(record as unknown as T);
  }

  return records;
}

export function parseCsvFile<T = Record<string, string>>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return parseCsv<T>(content);
}
