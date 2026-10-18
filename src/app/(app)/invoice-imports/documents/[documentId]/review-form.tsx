"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/money";
import type { DraftInvoice, DraftLine, DraftTotals } from "@/lib/invoice-import/draft";
import type { Evaluation } from "@/lib/invoice-import/pipeline";
import type { ExtractionIssue } from "@/lib/invoice-import/types";
import type { Acknowledgement, Assignments } from "@/lib/services/invoice-imports";
import {
  acknowledgeIssueAction,
  approveDocumentAction,
  rejectDocumentAction,
  reprocessDocumentAction,
  saveReviewAction,
} from "../../actions";

interface Props {
  documentId: string;
  status: string;
  fileUrl: string;
  mimeType: string;
  draft: DraftInvoice | null;
  evaluation: Evaluation | null;
  confidence: Record<string, number>;
  assignments: Assignments;
  acknowledgements: Acknowledgement[];
  catalogue: Array<{ id: string; sku: string; name: string }>;
  suppliers: Array<{ id: string; name: string; gstin: string | null }>;
  acknowledgeable: string[];
  canEdit: boolean;
  canApprove: boolean;
  canReprocess: boolean;
}

const TOTAL_FIELDS: Array<[keyof DraftTotals, string]> = [
  ["grossAmount", "Gross amount"],
  ["discountPercent", "Discount %"],
  ["discountAmount", "Discount"],
  ["taxableAmount", "Taxable value"],
  ["cgst", "CGST"],
  ["sgst", "SGST"],
  ["igst", "IGST"],
  ["freight", "Freight"],
  ["packing", "Packing"],
  ["otherCharges", "Other charges"],
  ["roundOff", "Round-off"],
  ["grandTotal", "Grand total"],
];

const CALCULATED_KEY: Partial<Record<keyof DraftTotals, keyof Evaluation["reconciliation"]["calculated"]>> = {
  grossAmount: "grossAmount",
  discountAmount: "discountAmount",
  taxableAmount: "taxableAmount",
  cgst: "cgst",
  sgst: "sgst",
  igst: "igst",
  roundOff: "roundOff",
  grandTotal: "grandTotal",
};

export function ReviewForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<DraftInvoice | null>(props.draft);
  const [products, setProducts] = useState<Record<string, string | null>>(props.assignments.products ?? {});
  const [supplierId, setSupplierId] = useState<string | null>(props.assignments.supplierId ?? null);
  const [remember, setRemember] = useState(true);
  const [dirty, setDirty] = useState(false);

  const issues = props.evaluation?.issues ?? [];
  const issuesByField = useMemo(() => {
    const map = new Map<string, ExtractionIssue[]>();
    for (const issue of issues) if (issue.field) map.set(issue.field, [...(map.get(issue.field) ?? []), issue]);
    return map;
  }, [issues]);
  const matchByLine = useMemo(() => new Map((props.evaluation?.matches ?? []).map((m) => [m.lineNo, m.match])), [props.evaluation]);
  const catalogueOptions = useMemo(() => props.catalogue.map((p) => ({ value: p.id, label: p.name, hint: p.sku })), [props.catalogue]);
  const productName = useMemo(() => new Map(props.catalogue.map((p) => [p.id, `${p.name} (${p.sku})`])), [props.catalogue]);

  if (!draft) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <SourceViewer url={props.fileUrl} mimeType={props.mimeType} />
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">No extracted data yet.</p>
          {props.canReprocess ? <ReprocessButton documentId={props.documentId} /> : null}
        </div>
      </div>
    );
  }

  const readOnly = !props.canEdit;
  const update = (patch: Partial<DraftInvoice>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const updateTotals = (key: keyof DraftTotals, value: number | null) => update({ totals: { ...draft.totals, [key]: value } });
  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    const lines = draft.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    update({ lines });
  };
  const fieldClass = (path: string) => {
    const list = issuesByField.get(path) ?? [];
    if (list.some((i) => i.severity === "ERROR" && !i.details?.acknowledged)) return "border-destructive ring-1 ring-destructive/40";
    if (list.some((i) => i.severity === "WARNING")) return "border-warning";
    return "";
  };

  function save(then?: () => void) {
    startTransition(async () => {
      const result = await saveReviewAction(props.documentId, { draft: draft!, productAssignments: products, supplierId, rememberAliases: remember });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDirty(false);
      toast.success(result.data.changes ? `Saved ${result.data.changes} change(s) — re-validated` : "Re-validated");
      router.refresh();
      then?.();
    });
  }

  function approve() {
    if (dirty) {
      toast.error("Save your changes first");
      return;
    }
    startTransition(async () => {
      const result = await approveDocumentAction(props.documentId);
      if (!result.ok) {
        toast.error(result.error, { duration: 10000 });
        router.refresh();
        return;
      }
      toast.success(result.data.message);
      router.refresh();
    });
  }

  function reject() {
    const reason = window.prompt("Why is this document being rejected?");
    if (!reason) return;
    startTransition(async () => {
      const result = await rejectDocumentAction(props.documentId, reason);
      if (!result.ok) toast.error(result.error);
      else toast.success("Rejected");
      router.refresh();
    });
  }

  function acknowledge(issue: ExtractionIssue) {
    const reason = window.prompt(`Accept this difference?\n\n${issue.message}\n\nReason (kept in the audit log):`);
    if (!reason) return;
    startTransition(async () => {
      const result = await acknowledgeIssueAction(props.documentId, issue.code, issue.field ?? null, reason);
      if (!result.ok) toast.error(result.error);
      else toast.success("Accepted");
      router.refresh();
    });
  }

  const calc = props.evaluation?.reconciliation.calculated;
  const errors = issues.filter((i) => i.severity === "ERROR" && !i.details?.acknowledged);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="xl:sticky xl:top-4 xl:self-start">
        <SourceViewer url={props.fileUrl} mimeType={props.mimeType} />
      </div>

      <div className="space-y-5">
        {/* Issues */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            Checks {errors.length ? <span className="text-destructive">· {errors.length} to resolve</span> : <span className="text-success">· nothing blocking</span>}
          </h2>
          <ul className="space-y-1.5">
            {issues.length === 0 ? <li className="text-sm text-muted-foreground">No findings.</li> : null}
            {issues.map((issue, index) => {
              const acknowledged = issue.details?.acknowledged as { reason: string } | undefined;
              const Icon = acknowledged ? CheckCircle2 : issue.severity === "ERROR" ? XCircle : issue.severity === "WARNING" ? AlertTriangle : Info;
              return (
                <li
                  key={`${issue.code}-${issue.field}-${index}`}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                    acknowledged ? "border-border bg-muted/30" : issue.severity === "ERROR" ? "border-destructive/40 bg-destructive/5" : issue.severity === "WARNING" ? "border-warning/50 bg-warning/5" : "border-border",
                  )}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", acknowledged ? "text-success" : issue.severity === "ERROR" ? "text-destructive" : issue.severity === "WARNING" ? "text-warning-foreground" : "text-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <p>{issue.message}</p>
                    {acknowledged ? <p className="text-xs text-muted-foreground">Accepted: {acknowledged.reason}</p> : null}
                  </div>
                  {!acknowledged && issue.severity === "ERROR" && props.canApprove && props.acknowledgeable.includes(issue.code) ? (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => acknowledge(issue)}>
                      Accept…
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Header */}
        <section className="grid gap-3 sm:grid-cols-2">
          <TextField label="Invoice number" path="invoiceNumber" value={draft.invoiceNumber} onChange={(v) => update({ invoiceNumber: v })} {...fieldProps("invoiceNumber")} />
          <TextField label="Invoice date" type="date" path="invoiceDate" value={draft.invoiceDate} onChange={(v) => update({ invoiceDate: v })} {...fieldProps("invoiceDate")} />
          <TextField label={draft.direction === "PURCHASE" ? "Supplier" : "Customer"} path="partyName" value={draft.partyName} onChange={(v) => update({ partyName: v })} {...fieldProps("partyName")} />
          <TextField label="GSTIN" path="partyGstin" value={draft.partyGstin} onChange={(v) => update({ partyGstin: v?.toUpperCase() ?? null })} {...fieldProps("partyGstin")} />
          <TextField label="Payment terms" path="paymentTerms" value={draft.paymentTerms} onChange={(v) => update({ paymentTerms: v })} {...fieldProps("paymentTerms")} />
          <TextField label="PO / reference" path="purchaseOrderNumber" value={draft.purchaseOrderNumber} onChange={(v) => update({ purchaseOrderNumber: v })} {...fieldProps("purchaseOrderNumber")} />
          <TextField label="Phone" path="partyPhone" value={draft.partyPhone} onChange={(v) => update({ partyPhone: v })} {...fieldProps("partyPhone")} />
          <div className="space-y-1">
            <Label className="text-xs">Document direction</Label>
            <select
              className={cn("h-9 w-full rounded-md border border-input bg-card px-2 text-sm", fieldClass("direction"))}
              value={draft.direction}
              disabled={readOnly}
              onChange={(e) => update({ direction: e.target.value as DraftInvoice["direction"] })}
            >
              <option value="SALES">Sales — issued by this firm</option>
              <option value="PURCHASE">Purchase — from a supplier</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </div>
          {draft.direction === "PURCHASE" ? (
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">ERP supplier</Label>
              <SearchableSelect
                options={props.suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.gstin ?? undefined }))}
                value={supplierId ?? ""}
                onValueChange={(v) => {
                  setSupplierId(v || null);
                  setDirty(true);
                }}
                placeholder="Choose the supplier…"
                disabled={readOnly}
                className={fieldClass("partyName")}
              />
            </div>
          ) : null}
        </section>

        {/* Lines */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Line items</h2>
            {!readOnly ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember confirmed products for next time
              </label>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Description / product</th>
                  <th className="px-2 py-1.5 text-left">HSN</th>
                  <th className="px-2 py-1.5 text-right">Qty</th>
                  <th className="px-2 py-1.5 text-left">Unit</th>
                  <th className="px-2 py-1.5 text-right">GST %</th>
                  <th className="px-2 py-1.5 text-right">Rate</th>
                  <th className="px-2 py-1.5 text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, index) => {
                  const match = matchByLine.get(line.lineNo);
                  const assigned = products[String(line.lineNo)] ?? null;
                  const p = (key: string) => `lines.${line.lineNo}.${key}`;
                  return (
                    <tr key={index} className="border-t align-top">
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {line.lineNo}
                        <select
                          className="mt-1 block rounded border bg-card text-[11px]"
                          value={line.kind}
                          disabled={readOnly}
                          onChange={(e) => updateLine(index, { kind: e.target.value as DraftLine["kind"] })}
                          title="Product line or discount/charge line"
                        >
                          <option value="ITEM">item</option>
                          <option value="ADJUSTMENT">charge</option>
                        </select>
                      </td>
                      <td className="min-w-[280px] px-2 py-1.5">
                        <CellInput value={line.description} readOnly={readOnly} className={fieldClass(p("description"))} confidence={props.confidence[p("description")]} onChange={(v) => updateLine(index, { description: v })} />
                        {line.kind === "ITEM" ? (
                          <div className={cn("mt-1 space-y-1 rounded border px-1.5 py-1", fieldClass(p("product")))}>
                            <MatchBadge match={match} assigned={assigned} />
                            <SearchableSelect
                              options={catalogueOptions}
                              value={assigned ?? match?.productId ?? ""}
                              onValueChange={(v) => {
                                setProducts({ ...products, [String(line.lineNo)]: v || null });
                                setDirty(true);
                              }}
                              placeholder={match?.candidates[0] ? `Suggested: ${match.candidates[0].name}` : "Find catalogue product…"}
                              disabled={readOnly}
                            />
                            {!assigned && match && match.status !== "MATCHED" && match.candidates.length ? (
                              <div className="flex flex-wrap gap-1">
                                {match.candidates.slice(0, 3).map((c) => (
                                  <button
                                    key={c.productId}
                                    type="button"
                                    disabled={readOnly}
                                    className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent"
                                    title={c.reason}
                                    onClick={() => {
                                      setProducts({ ...products, [String(line.lineNo)]: c.productId });
                                      setDirty(true);
                                    }}
                                  >
                                    {c.name} · {Math.round(c.score * 100)}%
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {assigned ? <p className="text-[11px] text-muted-foreground">{productName.get(assigned)}</p> : null}
                          </div>
                        ) : null}
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={line.rawText}>
                          {line.rawText}
                        </p>
                      </td>
                      <td className="w-24 px-2 py-1.5">
                        <CellInput value={line.hsn} readOnly={readOnly} className={fieldClass(p("hsn"))} confidence={props.confidence[p("hsn")]} onChange={(v) => updateLine(index, { hsn: v })} />
                      </td>
                      <td className="w-20 px-2 py-1.5">
                        <NumberInput value={line.quantity} readOnly={readOnly} className={fieldClass(p("quantity"))} confidence={props.confidence[p("quantity")]} onChange={(v) => updateLine(index, { quantity: v })} />
                      </td>
                      <td className="w-16 px-2 py-1.5">
                        <CellInput value={line.unit} readOnly={readOnly} onChange={(v) => updateLine(index, { unit: v })} />
                      </td>
                      <td className="w-16 px-2 py-1.5">
                        <NumberInput value={line.gstRate} readOnly={readOnly} className={fieldClass(p("gstRate"))} confidence={props.confidence[p("gstRate")]} onChange={(v) => updateLine(index, { gstRate: v })} />
                      </td>
                      <td className="w-28 px-2 py-1.5">
                        <NumberInput value={line.rate} readOnly={readOnly} className={fieldClass(p("rate"))} confidence={props.confidence[p("rate")]} onChange={(v) => updateLine(index, { rate: v })} />
                      </td>
                      <td className="w-28 px-2 py-1.5">
                        <NumberInput value={line.amount} readOnly={readOnly} className={fieldClass(p("amount"))} confidence={props.confidence[p("amount")]} onChange={(v) => updateLine(index, { amount: v })} />
                      </td>
                      <td className="px-1 py-1.5">
                        {!readOnly ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Remove line"
                            onClick={() => update({ lines: draft.lines.filter((_, i) => i !== index).map((l, i) => ({ ...l, lineNo: i + 1 })) })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!readOnly ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update({
                  lines: [
                    ...draft.lines,
                    { lineNo: draft.lines.length + 1, kind: "ITEM", description: null, hsn: null, sku: null, barcode: null, brand: null, quantity: 1, unit: null, rate: null, discountPercent: null, gstRate: null, amount: null, rawText: "(added by reviewer)" },
                  ],
                })
              }
            >
              <Plus className="size-4" /> Add line
            </Button>
          ) : null}
        </section>

        {/* Totals */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Totals — printed vs independently calculated</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left">Field</th>
                  <th className="px-3 py-1.5 text-right">Printed on invoice</th>
                  <th className="px-3 py-1.5 text-right">Calculated from lines</th>
                  <th className="px-3 py-1.5 text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {TOTAL_FIELDS.map(([key, label]) => {
                  const printed = draft.totals[key];
                  const calcKey = CALCULATED_KEY[key];
                  const calculated = calc && calcKey ? (calc[calcKey] as number) : null;
                  const diff = printed !== null && calculated !== null ? Math.round((printed - calculated) * 100) / 100 : null;
                  if (printed === null && (calculated === null || calculated === 0) && !["grandTotal", "taxableAmount", "grossAmount"].includes(key)) return null;
                  return (
                    <tr key={key} className={cn("border-t", key === "grandTotal" && "font-semibold")}>
                      <td className="px-3 py-1.5">{label}</td>
                      <td className="px-3 py-1.5 text-right">
                        <NumberInput value={printed} readOnly={readOnly} className={cn("ml-auto w-32 text-right", fieldClass(`totals.${key}`))} confidence={props.confidence[`totals.${key}`]} onChange={(v) => updateTotals(key, v)} />
                      </td>
                      <td className="numeric px-3 py-1.5 text-right">{calculated === null ? "—" : key === "discountPercent" ? calculated : formatCurrency(calculated)}</td>
                      <td className={cn("numeric px-3 py-1.5 text-right", diff && Math.abs(diff) > 0.009 ? "text-destructive" : "text-muted-foreground")}>
                        {diff === null ? "—" : diff.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {draft.amountInWords ? <p className="text-xs text-muted-foreground">In words: “{draft.amountInWords}”</p> : null}
          {calc && !calc.complete ? <p className="text-xs text-warning-foreground">Calculation incomplete: a line amount or GST rate is missing.</p> : null}
        </section>

        {/* Actions */}
        <section className="flex flex-wrap items-center gap-2 border-t pt-4">
          {props.canEdit ? (
            <Button onClick={() => save()} loading={pending} disabled={pending} variant={dirty ? "default" : "outline"}>
              {dirty ? "Save and re-validate" : "Re-validate"}
            </Button>
          ) : null}
          {props.canApprove ? (
            <Button variant="success" onClick={approve} disabled={pending || dirty} title={dirty ? "Save your changes first" : undefined}>
              <CheckCircle2 className="size-4" /> {draft.direction === "PURCHASE" ? "Approve and create draft PO" : "Approve"}
            </Button>
          ) : null}
          {props.canEdit ? (
            <Button variant="outline" onClick={reject} disabled={pending}>
              Reject
            </Button>
          ) : null}
          {props.canReprocess ? <ReprocessButton documentId={props.documentId} /> : null}
        </section>
      </div>
    </div>
  );

  function fieldProps(path: string) {
    return { readOnly, className: fieldClass(path), confidence: props.confidence[path] };
  }
}

function SourceViewer({ url, mimeType }: { url: string; mimeType: string }) {
  return (
    <div className="overflow-hidden rounded-md border bg-muted/30">
      {mimeType === "application/pdf" ? (
        <iframe src={url} title="Source document" className="h-[75vh] w-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Source document" className="w-full" />
      )}
      <a href={url} target="_blank" rel="noreferrer" className="block border-t px-3 py-1.5 text-xs text-primary hover:underline">
        Open original in a new tab
      </a>
    </div>
  );
}

function ReprocessButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Extract this document again? Corrections made here will be discarded.")) return;
        startTransition(async () => {
          const result = await reprocessDocumentAction(documentId);
          if (!result.ok) toast.error(result.error);
          else toast.success("Queued for extraction");
          router.refresh();
        });
      }}
    >
      <RefreshCw className="size-4" /> Re-extract
    </Button>
  );
}

function MatchBadge({ match, assigned }: { match: Evaluation["matches"][number]["match"] | undefined; assigned: string | null }) {
  if (assigned) return <span className="text-[11px] font-medium text-success">Product confirmed by reviewer</span>;
  if (!match) return null;
  const label: Record<string, [string, string]> = {
    MATCHED: [`Matched (${match.method?.toLowerCase().replace(/_/g, " ")})`, "text-success"],
    SUGGESTED: [`Suggestion ${Math.round(match.confidence * 100)}% — confirm`, "text-warning-foreground"],
    AMBIGUOUS: ["Several possible products — choose one", "text-warning-foreground"],
    UNMATCHED: ["No catalogue product found", "text-destructive"],
  };
  const [text, tone] = label[match.status] ?? [match.status, ""];
  return <span className={cn("text-[11px] font-medium", tone)}>{text}</span>;
}

function ConfidenceDot({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  const tone = value >= 0.95 ? "bg-success" : value >= 0.75 ? "bg-warning" : "bg-destructive";
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", tone)} title={`Extraction confidence ${Math.round(value * 100)}%`} />;
}

function TextField(props: {
  label: string;
  path: string;
  value: string | null;
  onChange: (value: string | null) => void;
  readOnly: boolean;
  className?: string;
  confidence?: number;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5 text-xs">
        {props.label} <ConfidenceDot value={props.confidence} />
      </Label>
      <Input
        type={props.type ?? "text"}
        value={props.value ?? ""}
        readOnly={props.readOnly}
        className={props.className}
        onChange={(e) => props.onChange(e.target.value.trim() ? e.target.value : null)}
      />
    </div>
  );
}

function CellInput(props: { value: string | null; onChange: (v: string | null) => void; readOnly: boolean; className?: string; confidence?: number }) {
  return (
    <div className="flex items-center gap-1">
      <ConfidenceDot value={props.confidence} />
      <input
        className={cn("h-7 w-full rounded border border-input bg-card px-1.5 text-sm", props.className)}
        value={props.value ?? ""}
        readOnly={props.readOnly}
        onChange={(e) => props.onChange(e.target.value.trim() ? e.target.value : null)}
      />
    </div>
  );
}

function NumberInput(props: { value: number | null; onChange: (v: number | null) => void; readOnly: boolean; className?: string; confidence?: number }) {
  const [text, setText] = useState(props.value === null ? "" : String(props.value));
  const [last, setLast] = useState(props.value);
  if (props.value !== last) {
    setLast(props.value);
    setText(props.value === null ? "" : String(props.value));
  }
  return (
    <div className="flex items-center gap-1">
      <ConfidenceDot value={props.confidence} />
      <input
        inputMode="decimal"
        className={cn("numeric h-7 w-full rounded border border-input bg-card px-1.5 text-right text-sm", props.className)}
        value={text}
        readOnly={props.readOnly}
        onChange={(e) => {
          setText(e.target.value);
          const cleaned = e.target.value.replace(/,/g, "").trim();
          const n = cleaned === "" ? null : Number(cleaned);
          if (n === null || Number.isFinite(n)) {
            setLast(n);
            props.onChange(n);
          }
        }}
      />
    </div>
  );
}
