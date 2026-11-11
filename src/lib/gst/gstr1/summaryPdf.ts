import "server-only";

import path from "node:path";

import PDFDocument from "pdfkit";

import type { Gstr1Report } from "./types";

/**
 * One-to-three page PDF summary of a GSTR-1 report: totals by table, the
 * reconciliation, and every unresolved finding. Only the bundled DejaVu fonts
 * are used (PDFKit's built-in fonts are not available in the production bundle).
 */
const REG = "DejaVuSans";
const BOLD = "DejaVuSans-Bold";
const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function gstr1SummaryPdf(rep: Gstr1Report, meta: { generatedAt: Date; company: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: `GSTR-1 summary ${rep.period.label}`, Author: meta.company } });
    doc.registerFont(REG, path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"));
    doc.registerFont(BOLD, path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"));
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 72;
    const h = (text: string) => { doc.moveDown(0.8).font(BOLD).fontSize(10.5).fillColor("#000").text(text); doc.moveDown(0.2); };
    const row = (cells: string[], widths: number[], opts: { bold?: boolean; color?: string; align?: ("left" | "right")[] } = {}) => {
      const y = doc.y;
      if (y > doc.page.height - 60) doc.addPage();
      const top = doc.y;
      let x = 36;
      doc.font(opts.bold ? BOLD : REG).fontSize(8.5).fillColor(opts.color ?? "#000");
      let tallest = 0;
      cells.forEach((c, i) => {
        const hgt = doc.heightOfString(c, { width: widths[i] - 4 });
        tallest = Math.max(tallest, hgt);
        doc.text(c, x, top, { width: widths[i] - 4, align: opts.align?.[i] ?? "left" });
        x += widths[i];
      });
      doc.y = top + tallest + 2;
      doc.x = 36;
    };
    const rule = () => { doc.moveTo(36, doc.y).lineTo(36 + W, doc.y).lineWidth(0.4).strokeColor("#999").stroke(); doc.moveDown(0.2); };

    doc.font(BOLD).fontSize(15).text(`GSTR-1 summary — ${rep.period.label}`);
    doc.font(REG).fontSize(9).fillColor("#444")
      .text(`${meta.company}   GSTIN ${rep.firm.gstin}   Generated ${meta.generatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`)
      .text(`Rules applied for this period: B2CL limit ₹${rep.rulesApplied.b2clThreshold.toLocaleString("en-IN")}, HSN of at least ${rep.rulesApplied.hsnMinDigits} digits, HSN ${rep.rulesApplied.hsnSplit ? "split B2B/B2C" : "single table"}.`);

    const errors = rep.issues.filter((i) => i.severity === "ERROR");
    const blocking = rep.issues.filter((i) => i.blocking);
    doc.moveDown(0.5).font(BOLD).fontSize(10).fillColor(blocking.length ? "#b00020" : "#1b5e20")
      .text(blocking.length ? `NOT READY TO FILE — ${blocking.length} unresolved item(s) must be corrected first.` : "No blocking issues.");
    doc.fillColor("#000");

    h("Totals by table");
    const w1 = [210, 90, 110, 110];
    row(["Table", "Count", "Value (₹)", "Taxable (₹)"], w1, { bold: true, align: ["left", "right", "right", "right"] });
    rule();
    const T = rep.totals;
    const lines: [string, string, string, string][] = [
      ["4A/4B/6B/6C  B2B, SEZ, deemed export", `${T.b2b.invoices} inv · ${T.b2b.recipients} rec`, fmt(T.b2b.value), fmt(T.b2b.taxable)],
      ["5  B2C large", `${T.b2cl.invoices} inv`, fmt(T.b2cl.value), fmt(T.b2cl.taxable)],
      ["7  B2C small (summary)", `${rep.b2cs.length} rows`, "", fmt(T.b2cs.taxable)],
      ["6A  Exports", `${T.exp.invoices} inv`, fmt(T.exp.value), fmt(T.exp.taxable)],
      ["9B  Credit/debit notes — registered", `${T.cdnr.notes} notes`, fmt(T.cdnr.value), fmt(T.cdnr.taxable)],
      ["9B  Credit/debit notes — unregistered", `${T.cdnur.notes} notes`, fmt(T.cdnur.value), fmt(T.cdnur.taxable)],
      ["11A  Advances received", "", fmt(T.at.amount), ""],
      ["11B  Advances adjusted", "", fmt(T.atadj.amount), ""],
      ["8  Nil-rated / exempted / non-GST", "", fmt(T.exemp.nil + T.exemp.exempted + T.exemp.nonGst), ""],
    ];
    for (const l of lines) row(l, w1, { align: ["left", "right", "right", "right"] });
    rule();
    row(["Net total (invoices − credit notes + debit notes)", `${T.invoiceCount} inv · ${T.noteCount} notes`, fmt(T.net.value), fmt(T.net.taxable)], w1, { bold: true, align: ["left", "right", "right", "right"] });
    row([`Tax: IGST ${fmt(T.net.igst)}   CGST ${fmt(T.net.cgst)}   SGST ${fmt(T.net.sgst)}   Cess ${fmt(T.net.cess)}`], [W]);

    h("Table 13 — documents issued");
    const w2 = [180, 90, 90, 70, 70];
    row(["Nature", "From", "To", "Total", "Cancelled"], w2, { bold: true });
    rule();
    for (const d of rep.docs) row([d.nature, d.from, d.to, String(d.total), String(d.cancelled)], w2);
    for (const d of rep.docs.filter((x) => x.missing.length)) row([`Missing from ${d.from}–${d.to}: ${d.missing.slice(0, 12).join(", ")}${d.missing.length > 12 ? "…" : ""}`], [W], { color: "#b00020" });

    h("Reconciliation");
    const w3 = [200, 85, 85, 85, 30];
    row(["Check", "Reported", "Independent", "Difference", ""], w3, { bold: true, align: ["left", "right", "right", "right", "left"] });
    rule();
    const isCount = (key: string) => key.startsWith("count.") || key === "docs.total" || key === "coverage";
    const show = (key: string, v: number | null) => (v === null ? "—" : isCount(key) ? String(Math.round(v)) : fmt(v));
    for (const r of rep.reconciliation) row([r.label, show(r.key, r.reported), show(r.key, r.expected), r.difference === null ? "—" : show(r.key, r.difference), r.ok === null ? "n/a" : r.ok ? "OK" : "DIFF"], w3, { color: r.ok === false ? "#b00020" : "#000", align: ["left", "right", "right", "right", "left"] });

    h(`Validation — ${errors.length} error(s), ${rep.issues.filter((i) => i.severity === "WARNING").length} warning(s)`);
    for (const i of rep.issues.filter((x) => x.severity !== "INFO").slice(0, 60)) {
      row([i.severity === "ERROR" ? "✖" : "⚠", `${i.docNumber ? `[${i.docNumber}] ` : ""}${i.message}${i.fix ? `  → ${i.fix}` : ""}`], [14, W - 14], { color: i.severity === "ERROR" ? "#b00020" : "#8a5a00" });
    }
    if (rep.issues.length > 60) row([`… and ${rep.issues.length - 60} more (see the issues CSV).`], [W]);

    doc.moveDown(1).font(REG).fontSize(7.5).fillColor("#555")
      .text("This summary reflects the ERP's records as of generation. Portal JSON is checked against a built-in structural schema, not the official GST portal schema, unless the official schema file has been supplied.", { width: W });
    doc.end();
  });
}
