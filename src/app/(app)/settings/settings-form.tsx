"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveSettingsAction } from "./actions";

const FIELDS: { key: string; label: string; textarea?: boolean; select?: { value: string; label: string }[]; hint?: string }[] = [
  { key: "company_phone", label: "Phone" },
  { key: "company_email", label: "Email" },
  { key: "company_website", label: "Website" },
  { key: "sequence_invoice_gst", label: "GST invoice prefix ({FY} = financial year)" },
  { key: "sequence_invoice_non_gst", label: "Non-Tax Invoice prefix" },
  { key: "company_bank_details", label: "Bank details (printed on invoices)", textarea: true },
  { key: "document_terms", label: "Default terms & conditions", textarea: true },
  { key: "document_footer_text", label: "Document footer", textarea: true },
  { key: "gst_trade_name", label: "GST return: trade name (if any)" },
  {
    key: "gst_aato_band",
    label: "GST return: aggregate annual turnover",
    select: [
      { value: "", label: "Not set" },
      { value: "UPTO_5CR", label: "Up to ₹5 crore (4-digit HSN)" },
      { value: "ABOVE_5CR", label: "Above ₹5 crore (6-digit HSN)" },
    ],
  },
  { key: "gst_turnover_prev_fy", label: "GST return: turnover of the preceding financial year (₹)", hint: "GSTR-1 table 3.a. Leave blank if unknown — it is never guessed." },
  { key: "gst_turnover_cur_fy", label: "GST return: cumulative turnover of the current financial year (₹)", hint: "Needed only for the portal JSON (cur_gt)." },
];

export function SettingsForm({
  firmName,
  gstin,
  initialValues,
}: {
  firmName: string;
  gstin: string;
  initialValues: Record<string, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await saveSettingsAction({ values });
      if (result.ok) {
        toast.success("Settings saved");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Firm</p>
          <p className="font-medium">{firmName}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">GSTIN</p>
          <p className="font-mono">{gstin || "Not configured"}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.textarea ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Label htmlFor={`set-${field.key}`}>{field.label}</Label>
            {field.textarea ? (
              <Textarea
                id={`set-${field.key}`}
                rows={3}
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            ) : field.select ? (
              <select
                id={`set-${field.key}`}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              >
                {field.select.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`set-${field.key}`}
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            )}
            {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
          </div>
        ))}
      </div>

      <Button onClick={submit} disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}
