import ExcelJS from "exceljs";

import type { Cell, SheetModel } from "./sheets";
import { toSheetModels } from "./sheets";
import type { Gstr1Report } from "./types";

/**
 * Writes the sheet models with ExcelJS. The reference workbook is deliberately
 * plain — one default cell style (Calibri 12), no fills, borders or number
 * formats — so that is what is produced; layout fidelity is in positions,
 * types and column widths.
 */
const FONT = { name: "Calibri", size: 12, family: 2, scheme: "minor" as const };
const ROW_HEIGHT = 15.75;

export function writeWorkbook(models: SheetModel[], meta: { creator?: string } = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.creator ?? "Technic ERP";
  wb.created = new Date();
  for (const model of models) {
    const ws = wb.addWorksheet(model.name);
    for (const [first, last, width] of model.widths) for (let c = first; c <= last; c++) ws.getColumn(c).width = width;
    for (const { row, cells } of model.rows) {
      const r = ws.getRow(row);
      r.height = ROW_HEIGHT;
      cells.forEach((value: Cell, i) => {
        if (value === null) return;
        const cell = r.getCell(i + 1);
        cell.value = value;
        cell.font = FONT;
      });
      r.commit?.();
    }
  }
  return wb;
}

export async function gstr1WorkbookBuffer(report: Gstr1Report): Promise<Buffer> {
  const wb = writeWorkbook(toSheetModels(report));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
