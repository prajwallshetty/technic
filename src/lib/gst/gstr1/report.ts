import { buildSections, sectionTotals } from "./engine";
import { reconcile } from "./reconcile";
import { validate } from "./validate";
import type { Gstr1Report, GstrInput } from "./types";

/**
 * Builds the complete GSTR-1 report from normalised documents: the 14 sheets'
 * data, validation findings and reconciliation. Pure — same input, same output.
 */
export function buildGstr1(input: GstrInput): Gstr1Report {
  const sec = buildSections(input);
  const issues = validate(input, sec);
  const reconciliation = reconcile(input, sec);
  const failedRec = reconciliation.filter((r) => r.ok === false);
  for (const r of failedRec) {
    issues.push({
      code: "RECONCILIATION_DIFFERENCE", severity: "ERROR", blocking: true,
      message: `Reconciliation: ${r.label} — reported ${r.reported?.toFixed(2)} vs ${r.source} ${r.expected?.toFixed(2)} (difference ${r.difference?.toFixed(2)}).`,
      fix: "Resolve the documents behind the difference (see the validation findings), then regenerate.",
    });
  }
  return {
    firm: input.firm, period: input.period,
    rows: sec.rows, b2b: sec.b2b, b2cl: sec.b2cl, b2cs: sec.b2cs, cdnr: sec.cdnr, cdnur: sec.cdnur, exp: sec.exp,
    at: sec.at, atadj: sec.atadj, exemp: sec.exemp, hsnB2b: sec.hsnB2b, hsnB2c: sec.hsnB2c, items: sec.items, hsnTotals: sec.hsnTotals, docs: sec.docs,
    issues, reconciliation, totals: sectionTotals(sec),
    rulesApplied: { b2clThreshold: sec.rules.b2clThreshold, hsnMinDigits: sec.rules.hsnMinDigits, hsnSplit: sec.rules.hsnSplit },
  };
}

export function periodFor(from: string, to: string): { from: string; to: string; label: string; fp: string } {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  return { from, to, label: `${name(from)} - ${name(to)}`, fp: `${from.slice(5, 7)}${from.slice(0, 4)}` };
}
