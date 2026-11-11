"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileJson, FileSpreadsheet, FileText, Info, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Cell, SheetModel } from "@/lib/gst/gstr1/sheets";
import type { DocSeriesRow, FirmGstProfile, Issue, ReconciliationLine, SectionTotals } from "@/lib/gst/gstr1/types";
import { bulkHsnAction, fixInvoiceGstAction, fixLineGstAction } from "./actions";

interface Data {
  period: { from: string; to: string; label: string; fp: string };
  firm: FirmGstProfile;
  totals: SectionTotals;
  issues: Issue[];
  reconciliation: ReconciliationLine[];
  docs: DocSeriesRow[];
  rules: { b2clThreshold: number; hsnMinDigits: number; hsnSplit: boolean };
  previews: { name: string; totalRows: number; rows: SheetModel["rows"] }[];
  jsonBlockers: string[];
}

interface Props {
  controls: { fy: string; month: string; from: string; to: string; gstin: string };
  fyOptions: { value: string; label: string }[];
  gstins: { gstin: string; label: string }[];
  data: Data | null;
  canExport: boolean;
  canFix: boolean;
  sheetNames: string[];
  states: { code: string; name: string }[];
  uqcs: { code: string; label: string }[];
}

const MONTHS = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
const isCount = (key: string) => key.startsWith("count.") || key === "docs.total" || key === "coverage";
const inr = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const FIXABLE = new Set(["POS_MISSING", "POS_INVALID", "HSN_MISSING", "HSN_INVALID", "HSN_TOO_SHORT", "GSTIN_INVALID", "GSTIN_MISSING", "UQC_INVALID", "ZERO_RATE_TAXABLE"]);

export function Gstr1View(props: Props) {
  const { controls, data } = props;
  const router = useRouter();
  const [fy, setFy] = useState(controls.fy);
  const [month, setMonth] = useState(controls.month);
  const [from, setFrom] = useState(controls.from);
  const [to, setTo] = useState(controls.to);
  const [gstin, setGstin] = useState(controls.gstin);
  const [tab, setTab] = useState<"checks" | "recon" | "preview">("checks");
  const [sheet, setSheet] = useState(props.sheetNames[0]);
  const [fixing, setFixing] = useState<Issue | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function generate() {
    const q = new URLSearchParams();
    if (from && to) { q.set("from", from); q.set("to", to); }
    else if (month) q.set("month", month);
    else if (fy) q.set("fy", fy);
    if (gstin) q.set("gstin", gstin);
    if (![...q.keys()].some((k) => ["from", "month", "fy"].includes(k))) { toast.error("Choose a financial year, a month, or a date range"); return; }
    router.push(`/reports/gstr1?${q.toString()}`);
  }

  const qs = data ? new URLSearchParams({ from: data.period.from, to: data.period.to, ...(gstin ? { gstin } : {}) }) : null;

  async function download(format: "xlsx" | "json") {
    if (!qs || !data) return;
    setBusy(format);
    try {
      let res = await fetch(`/api/gstr1/export?format=${format}&${qs}`);
      if (res.status === 409 && format === "xlsx") {
        const body = await res.json();
        if (!window.confirm(`${body.error}\n\nThe workbook will contain the data exactly as recorded (missing values stay blank). Download it anyway for review?`)) return;
        res = await fetch(`/api/gstr1/export?format=xlsx&acknowledge=1&${qs}`);
      }
      if (res.status === 422) { const body = await res.json(); setBlockers(body.blockers ?? [body.error]); return; }
      if (!res.ok) { const body = await res.json().catch(() => ({})); toast.error(body.error ?? "Download failed"); return; }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `GSTR1.${format}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      if (format === "json" && res.headers.get("X-Schema-Check") === "built-in-only") toast.warning("JSON checked against the built-in schema only — not the official GST portal schema.", { duration: 9000 });
    } finally { setBusy(null); }
  }

  const issues = data?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING");
  const blocking = issues.filter((i) => i.blocking && !i.jsonOnly);
  const recFail = (data?.reconciliation ?? []).filter((r) => r.ok === false);
  const sheetData = data?.previews.find((p) => p.name === sheet);

  return (
    <div className="space-y-4">
      {/* ---- controls ---- */}
      <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1">
          <Label className="text-xs">Financial year</Label>
          <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={fy} onChange={(e) => { setFy(e.target.value); setMonth(""); setFrom(""); setTo(""); }}>
            <option value="">—</option>
            {props.fyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Month</Label>
          <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={month} onChange={(e) => { setMonth(e.target.value); setFrom(""); setTo(""); }}>
            <option value="">Whole year / custom</option>
            {(fy ? MONTHS.map((m, i) => { const y = Number(fy) + (i >= 9 ? 1 : 0); const mm = String(((i + 3) % 12) + 1).padStart(2, "0"); return { value: `${y}-${mm}`, label: `${m} ${y}` }; }) : []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label className="text-xs">From (custom)</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMonth(""); }} /></div>
        <div className="space-y-1"><Label className="text-xs">To (custom)</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMonth(""); }} /></div>
        <div className="space-y-1">
          <Label className="text-xs">GSTIN</Label>
          <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={gstin} onChange={(e) => setGstin(e.target.value)}>
            {props.gstins.length === 0 ? <option value="">No GSTIN configured</option> : null}
            {props.gstins.map((g) => <option key={g.gstin} value={g.gstin}>{g.label}</option>)}
          </select>
        </div>
        <div className="flex items-end"><Button className="w-full" onClick={generate}>Generate GSTR-1</Button></div>
      </div>

      {!data ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Choose a period and generate the report to see the checks, reconciliation and a preview of every sheet.
        </p>
      ) : (
        <>
          {/* ---- status banner ---- */}
          <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3", blocking.length || recFail.length ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5")}>
            <div className="space-y-0.5">
              <p className="font-semibold">{data.period.label} · GSTIN {data.firm.gstin}</p>
              <p className="text-sm text-muted-foreground">
                {data.totals.invoiceCount} invoice(s), {data.totals.noteCount} note(s), {data.totals.cancelledCount} cancelled ·{" "}
                {blocking.length ? <span className="font-medium text-destructive">{blocking.length} issue(s) must be corrected before filing</span> : <span className="font-medium text-success">no blocking issues</span>}
                {recFail.length ? <span className="font-medium text-destructive"> · {recFail.length} reconciliation difference(s)</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">Rules for this period: B2CL limit ₹{data.rules.b2clThreshold.toLocaleString("en-IN")}, HSN of at least {data.rules.hsnMinDigits} digits, HSN {data.rules.hsnSplit ? "split B2B / B2C" : "in one table"}.</p>
            </div>
            {props.canExport && qs ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => download("xlsx")} loading={busy === "xlsx"}><FileSpreadsheet className="size-4" /> Export GSTR-1 (Excel)</Button>
                <Button variant="outline" onClick={() => download("json")} loading={busy === "json"} title={data.jsonBlockers.length ? `${data.jsonBlockers.length} item(s) block the JSON` : undefined}><FileJson className="size-4" /> Portal JSON{data.jsonBlockers.length ? ` (${data.jsonBlockers.length} blocking)` : ""}</Button>
                <Button asChild variant="outline"><a href={`/api/gstr1/export?format=pdf&${qs}`}><FileText className="size-4" /> PDF summary</a></Button>
                <Button asChild variant="ghost"><a href={`/api/gstr1/export?format=issues&${qs}`}><Download className="size-4" /> Issues CSV</a></Button>
              </div>
            ) : null}
          </div>

          {/* ---- totals ---- */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["B2B / SEZ / DE", `${data.totals.b2b.invoices} invoices · ${data.totals.b2b.recipients} recipients`, data.totals.b2b.taxable],
              ["B2C large (B2CL)", `${data.totals.b2cl.invoices} invoices`, data.totals.b2cl.taxable],
              ["B2C small (B2CS)", "summary by state and rate", data.totals.b2cs.taxable],
              ["Credit / debit notes", `${data.totals.cdnr.notes + data.totals.cdnur.notes} notes`, data.totals.cdnr.taxable + data.totals.cdnur.taxable],
              ["Exports", `${data.totals.exp.invoices} invoices`, data.totals.exp.taxable],
              ["Nil / exempt / non-GST", "table 8", data.totals.exemp.nil + data.totals.exemp.exempted + data.totals.exemp.nonGst],
              ["Advances 11A / 11B", `${inr(data.totals.at.amount)} / ${inr(data.totals.atadj.amount)}`, null],
              ["Net taxable value", `Tax ₹${inr(data.totals.net.cgst + data.totals.net.sgst + data.totals.net.igst)}`, data.totals.net.taxable],
            ].map(([label, sub, value]) => (
              <div key={String(label)} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="numeric text-lg font-semibold">{value === null ? "—" : `₹${inr(Number(value))}`}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>

          {/* ---- tabs ---- */}
          <div className="flex gap-1 border-b border-border">
            {([["checks", `Validation (${errors.length} errors, ${warnings.length} warnings)`], ["recon", `Reconciliation${recFail.length ? ` (${recFail.length} differ)` : ""}`], ["preview", "Preview sheets"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} className={cn("border-b-2 px-3 py-2 text-sm", tab === key ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>

          {tab === "checks" ? (
            <ul className="space-y-1.5">
              {issues.length === 0 ? <li className="text-sm text-muted-foreground">No findings — every check passed.</li> : null}
              {issues.map((issue, index) => {
                const Icon = issue.severity === "ERROR" ? XCircle : issue.severity === "WARNING" ? AlertTriangle : Info;
                return (
                  <li key={`${issue.code}-${issue.docId}-${issue.lineId}-${index}`} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", issue.severity === "ERROR" ? "border-destructive/40 bg-destructive/5" : issue.severity === "WARNING" ? "border-warning/50 bg-warning/5" : "border-border")}>
                    <Icon className={cn("mt-0.5 size-4 shrink-0", issue.severity === "ERROR" ? "text-destructive" : issue.severity === "WARNING" ? "text-warning-foreground" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p>{issue.message}{issue.blocking ? <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive">{issue.jsonOnly ? "blocks JSON" : "blocking"}</span> : null}</p>
                      {issue.fix ? <p className="text-xs text-muted-foreground">→ {issue.fix}</p> : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {issue.link ? <Button asChild size="sm" variant="ghost"><Link href={issue.link} target="_blank">Open</Link></Button> : null}
                      {props.canFix && issue.docId && issue.docKind === "INVOICE" && FIXABLE.has(issue.code) ? <Button size="sm" variant="outline" onClick={() => setFixing(issue)}><Wrench className="size-3.5" /> Fix</Button> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {tab === "recon" ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left">Check</th><th className="px-3 py-1.5 text-right">Reported</th><th className="px-3 py-1.5 text-right">Independent figure</th><th className="px-3 py-1.5 text-right">Difference</th><th className="px-3 py-1.5 text-left">Source</th><th /></tr></thead>
                <tbody>
                  {data.reconciliation.map((r) => (
                    <tr key={r.key} className={cn("border-t", r.ok === false && "bg-destructive/5")}>
                      <td className="px-3 py-1.5">{r.label}{r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}</td>
                      <td className="numeric px-3 py-1.5 text-right">{isCount(r.key) && r.reported !== null ? r.reported : inr(r.reported)}</td>
                      <td className="numeric px-3 py-1.5 text-right">{isCount(r.key) && r.expected !== null ? r.expected : inr(r.expected)}</td>
                      <td className={cn("numeric px-3 py-1.5 text-right", r.ok === false && "font-semibold text-destructive")}>{inr(r.difference)}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.source}</td>
                      <td className="px-3 py-1.5">{r.ok === null ? "n/a" : r.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "preview" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">{props.sheetNames.map((n) => <button key={n} onClick={() => setSheet(n)} className={cn("rounded border px-2 py-1 text-xs", sheet === n ? "border-primary bg-primary/10 font-semibold" : "hover:bg-accent")}>{n}</button>)}</div>
              <div className="max-h-[60vh] overflow-auto rounded-md border">
                <table className="text-xs">
                  <tbody>
                    {sheetData?.rows.map((r) => (
                      <tr key={r.row} className="border-b last:border-0">
                        <td className="sticky left-0 bg-muted px-2 py-1 text-right text-muted-foreground">{r.row}</td>
                        {r.cells.map((c: Cell, i) => <td key={i} className={cn("whitespace-nowrap border-l px-2 py-1", typeof c === "number" && "numeric text-right")}>{c === null ? "" : String(c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sheetData && sheetData.totalRows > 200 ? <p className="text-xs text-muted-foreground">Showing the first 200 of {sheetData.totalRows} rows — the download has them all.</p> : null}
            </div>
          ) : null}
        </>
      )}

      {fixing ? <FixDialog issue={fixing} states={props.states} uqcs={props.uqcs} onClose={() => setFixing(null)} onDone={() => { setFixing(null); router.refresh(); }} /> : null}

      <Dialog open={blockers !== null} onOpenChange={(o) => !o && setBlockers(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>The portal JSON cannot be produced yet</DialogTitle><DialogDescription>A file with guessed values would be rejected or wrong, so it is not generated until these are resolved.</DialogDescription></DialogHeader>
          <ul className="max-h-72 list-disc space-y-1 overflow-auto pl-5 text-sm">{blockers?.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <DialogFooter><Button onClick={() => setBlockers(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FixDialog({ issue, states, uqcs, onClose, onDone }: { issue: Issue; states: { code: string; name: string }[]; uqcs: { code: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [pos, setPos] = useState("");
  const [hsn, setHsn] = useState("");
  const [uqc, setUqc] = useState("");
  const [gstin, setGstin] = useState("");
  const [alsoCustomer, setAlsoCustomer] = useState(true);
  const [allLines, setAllLines] = useState(true);
  const [alsoProduct, setAlsoProduct] = useState(true);
  const [taxability, setTaxability] = useState("NIL_RATED");

  const isPos = issue.code === "POS_MISSING" || issue.code === "POS_INVALID";
  const isHsn = ["HSN_MISSING", "HSN_INVALID", "HSN_TOO_SHORT"].includes(issue.code);
  const isGstin = issue.code === "GSTIN_INVALID" || issue.code === "GSTIN_MISSING";
  const isUqc = issue.code === "UQC_INVALID";
  const isZero = issue.code === "ZERO_RATE_TAXABLE";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error ?? "Could not save"); return; }
      toast.success("Corrected — re-checking");
      onDone();
    });
  }
  function save() {
    if (isPos) return run(() => fixInvoiceGstAction(issue.docId!, { placeOfSupplyCode: pos || null }) as never);
    if (isGstin) return run(() => fixInvoiceGstAction(issue.docId!, { billToGstin: gstin, alsoUpdateCustomer: alsoCustomer }) as never);
    if (isHsn && issue.productId && allLines) return run(() => bulkHsnAction(issue.productId!, { hsnCode: hsn, uqc: uqc || null, updateProduct: alsoProduct }) as never);
    if (isHsn && issue.lineId) return run(() => fixLineGstAction(issue.lineId!, { hsnCode: hsn, ...(uqc ? { uqc } : {}), updateProduct: alsoProduct }) as never);
    if (isUqc && issue.lineId) return run(() => fixLineGstAction(issue.lineId!, { uqc, updateProduct: alsoProduct }) as never);
    if (isZero && issue.lineId) return run(() => fixLineGstAction(issue.lineId!, { taxability: taxability as never, updateProduct: false }) as never);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct GST details</DialogTitle>
          <DialogDescription>{issue.message}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Only the GST classification is changed — amounts, quantities and rates are never touched. The change is recorded in the audit log.</p>
          {isPos ? (
            <div className="space-y-1"><Label>Place of supply (state)</Label>
              <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={pos} onChange={(e) => setPos(e.target.value)}>
                <option value="">Choose…</option>{states.map((s) => <option key={s.code} value={s.code}>{s.code}-{s.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Use the state the goods were delivered to / consumed in. Do not guess from the customer's name.</p>
            </div>
          ) : null}
          {isGstin ? (
            <div className="space-y-2"><Label>Customer GSTIN</Label><Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" className="font-mono" />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={alsoCustomer} onChange={(e) => setAlsoCustomer(e.target.checked)} /> Also correct it on the customer record</label>
              <p className="text-xs text-muted-foreground">The format and check digit are verified. Confirm the number on the GST portal before saving.</p></div>
          ) : null}
          {isHsn || isUqc ? (
            <div className="space-y-2">
              {isHsn ? <><Label>HSN / SAC code</Label><Input value={hsn} onChange={(e) => setHsn(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 85071000" className="font-mono" /></> : null}
              <Label>Unit (UQC){isHsn ? " — optional" : ""}</Label>
              <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={uqc} onChange={(e) => setUqc(e.target.value)}><option value="">{isHsn ? "Leave as is" : "Choose…"}</option>{uqcs.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}</select>
              {isHsn && issue.productId ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={allLines} onChange={(e) => setAllLines(e.target.checked)} /> Apply to every invoice line of this product that has no HSN</label> : null}
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={alsoProduct} onChange={(e) => setAlsoProduct(e.target.checked)} /> Also save on the product, so future invoices carry it</label>
            </div>
          ) : null}
          {isZero ? (
            <div className="space-y-1"><Label>This 0% line is</Label>
              <select className="h-9 w-full rounded-md border border-input bg-card px-2" value={taxability} onChange={(e) => setTaxability(e.target.value)}>
                <option value="NIL_RATED">Nil-rated</option><option value="EXEMPTED">Exempted</option><option value="NON_GST">Non-GST supply</option>
              </select>
              <p className="text-xs text-muted-foreground">Ask your CA if unsure. It moves the value from the rate tables to table 8.</p></div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} loading={pending} disabled={pending || (isPos && !pos) || (isGstin && !gstin) || (isHsn && !hsn) || (isUqc && !uqc)}>Save correction</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
