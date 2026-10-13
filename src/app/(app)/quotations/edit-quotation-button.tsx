"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Tag, Trash2, PackagePlus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/money";
import { parseNumericInput, tidyAmountOnBlur, tidyQuantityOnBlur } from "@/lib/numeric-input";
import { computeDiscountSummary, tidyDiscountOnBlur, type DiscountType } from "@/lib/discounts";
import { cn } from "@/lib/utils";
import {
  QuickAddCustomerDialog,
  QuickAddProductDialog,
  type QuickCustomer,
  type QuickProduct,
} from "@/components/shared/quick-add";
import { updateQuotationAction } from "./actions";

interface ProductOption {
  id: string;
  name: string;
  subName?: string | null;
  sku: string;
  sellingPrice: number;
  gstRate: number;
  trackSerials: boolean;
}

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

interface Line {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  trackSerials: boolean;
  serials: string[];
}

export interface QuotationProp {
  id: string;
  quotationNumber: string;
  taxMode: "GST" | "NON_GST" | string;
  status: string;
  quotationDate: Date | string;
  validUntil?: Date | string | null;
  discountAmount?: number | string | unknown;
  roundOff?: number | string | unknown;
  totalAmount?: number | string | unknown;
  notes?: string | null;
  terms?: string | null;
  discountRemarks?: string | null;
  customerId: string;
  customer?: { id?: string; name: string; phone?: string | null };
  lines: Array<{
    id?: string;
    productId: string;
    product?: {
      id?: string;
      name: string;
      subName?: string | null;
      sku?: string;
      sellingPrice?: number | string | unknown;
      gstRate?: number | string | unknown;
      trackSerials?: boolean;
    } | null;
    quantity: number;
    unitPrice: number | string | unknown;
    discountPercent?: number | string | unknown;
    gstRate?: number | string | unknown;
    serialNumbers?: string[] | string | null;
    description?: string;
  }>;
}

function formatDateForInput(dateVal?: Date | string | null): string {
  if (!dateVal) return "";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function EditQuotationButton({
  quotation,
  canSwitchMode = true,
  defaultOpen = false,
  triggerVariant = "outline",
  triggerSize = "sm",
  showLabel = true,
  children,
}: {
  quotation: QuotationProp;
  canSwitchMode?: boolean;
  defaultOpen?: boolean;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm" | "icon" | "icon-sm";
  showLabel?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);

  const initialTaxMode = (quotation.taxMode === "GST" ? "GST" : "NON_GST") as "GST" | "NON_GST";
  const [taxMode, setTaxMode] = useState<"GST" | "NON_GST">(initialTaxMode);
  const [status, setStatus] = useState<"DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED">(
    ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(quotation.status)
      ? (quotation.status as "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED")
      : "DRAFT",
  );
  const [customerId, setCustomerId] = useState(quotation.customerId);
  const [quotationDate, setQuotationDate] = useState(formatDateForInput(quotation.quotationDate));
  const [validUntil, setValidUntil] = useState(formatDateForInput(quotation.validUntil));
  const [notes, setNotes] = useState(quotation.notes ?? "");
  const [terms, setTerms] = useState(quotation.terms ?? "");
  const initialDiscount = Number(quotation.discountAmount) > 0 ? String(Number(quotation.discountAmount)) : "";
  const [billDiscount, setBillDiscount] = useState(initialDiscount);
  const [billDiscountType, setBillDiscountType] = useState<DiscountType>("₹");
  const [discountRemarks, setDiscountRemarks] = useState(quotation.discountRemarks ?? "");
  const initialRoundOff = (quotation as any).roundOff != null && Number((quotation as any).roundOff) !== 0 ? String(Number((quotation as any).roundOff)) : "";
  const [roundOff, setRoundOff] = useState(initialRoundOff);
  const [isManualRoundOff, setIsManualRoundOff] = useState(Boolean(initialRoundOff));

  // Seed customer list with the quotation's current customer
  const [customers, setCustomers] = useState<CustomerOption[]>(() => {
    if (quotation.customer) {
      return [{
        id: quotation.customerId,
        name: quotation.customer.name,
        phone: quotation.customer.phone ?? "",
      }];
    }
    return [];
  });

  // Seed product list with items from the quotation lines
  const [products, setProducts] = useState<ProductOption[]>(() => {
    const list: ProductOption[] = [];
    for (const line of quotation.lines) {
      if (line.product) {
        list.push({
          id: line.productId,
          name: line.product.name,
          subName: line.product.subName ?? null,
          sku: line.product.sku ?? "",
          sellingPrice: Number(line.product.sellingPrice ?? line.unitPrice),
          gstRate: Number(line.product.gstRate ?? line.gstRate ?? 18),
          trackSerials: Boolean(line.product.trackSerials),
        });
      }
    }
    return list;
  });

  let lineCounter = 1;
  const [lines, setLines] = useState<Line[]>(() => {
    return quotation.lines.map((l, index) => {
      const serials = Array.isArray(l.serialNumbers)
        ? l.serialNumbers
        : typeof l.serialNumbers === "string"
        ? l.serialNumbers.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
        : [];

      return {
        key: index + 1,
        productId: l.productId,
        quantity: String(l.quantity),
        unitPrice: String(Number(l.unitPrice)),
        trackSerials: Boolean(l.product?.trackSerials ?? serials.length > 0),
        serials: serials.length > 0 ? serials : Array.from({ length: l.quantity }, () => ""),
      };
    });
  });

  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [addProductForLine, setAddProductForLine] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/customers").then((r) => (r.ok ? r.json() : { customers: [] })),
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
    ])
      .then(([customersRes, productsRes]) => {
        const fetchedCustomers: CustomerOption[] = customersRes.customers ?? [];
        const fetchedProducts: ProductOption[] = productsRes.products ?? [];

        setCustomers((curr) => {
          const map = new Map(curr.map((c) => [c.id, c]));
          for (const c of fetchedCustomers) map.set(c.id, c);
          return Array.from(map.values());
        });

        setProducts((curr) => {
          const map = new Map(curr.map((p) => [p.id, p]));
          for (const p of fetchedProducts) map.set(p.id, p);
          return Array.from(map.values());
        });
      })
      .catch(() => {});
  }, [open]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const customerOptions: SearchableOption[] = customers.map((c) => ({
    value: c.id,
    label: c.name,
    hint: c.phone,
  }));

  const productOptions: SearchableOption[] = products.map((p) => ({
    value: p.id,
    label: p.subName ? `${p.name} — ${p.subName}` : p.name,
    hint: `${p.sku} · ${formatCurrency(p.sellingPrice)}`,
  }));

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((curr) => curr.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () => {
    lineCounter += 1;
    setLines((curr) => [
      ...curr,
      {
        key: Date.now() + Math.random(),
        productId: "",
        quantity: "1",
        unitPrice: "0",
        trackSerials: false,
        serials: [],
      },
    ]);
  };

  const onProductCreated = (created: QuickProduct) => {
    setProducts((curr) => [...curr, { ...created }]);
    setLines((curr) => {
      const target =
        curr.find((line) => line.key === addProductForLine && !line.productId) ??
        curr.find((line) => !line.productId);
      const filled: Partial<Line> = {
        productId: created.id,
        unitPrice: String(created.sellingPrice),
        trackSerials: created.trackSerials,
        serials: created.trackSerials ? [""] : [],
      };
      if (target) return curr.map((line) => (line.key === target.key ? { ...line, ...filled } : line));
      return [
        ...curr,
        { key: Date.now(), quantity: "1", ...filled } as Line,
      ];
    });
    setAddProductForLine(null);
  };

  const onCustomerCreated = (created: QuickCustomer) => {
    setCustomers((curr) => [...curr, { id: created.id, name: created.name, phone: created.phone }]);
    setCustomerId(created.id);
  };

  const validLines = lines.filter((l) => l.productId);
  const totals = useMemo(() => {
    return computeDiscountSummary({
      lines: validLines.map((l) => {
        const product = productById.get(l.productId);
        return {
          quantity: parseNumericInput(l.quantity),
          unitPrice: parseNumericInput(l.unitPrice),
          discountValue: 0,
          gstRate: product?.gstRate ?? 18,
        };
      }),
      billDiscount:
        parseNumericInput(billDiscount) > 0
          ? {
              type: billDiscountType,
              value: parseNumericInput(billDiscount),
            }
          : null,
      mode: taxMode,
      manualRoundOff: isManualRoundOff ? parseNumericInput(roundOff) : undefined,
    });
  }, [validLines, billDiscount, billDiscountType, taxMode, productById, isManualRoundOff, roundOff]);

  const submit = () => {
    startTransition(async () => {
      const result = await updateQuotationAction({
        quotationId: quotation.id,
        customerId,
        taxMode,
        quotationDate: quotationDate || null,
        validUntil: validUntil || null,
        notes: notes || null,
        terms: terms || null,
        discountRemarks: discountRemarks || null,
        status,
        manualRoundOff: isManualRoundOff ? parseNumericInput(roundOff) : null,
        lines: validLines.map((line, index) => {
          const product = productById.get(line.productId);
          return {
            productId: line.productId,
            quantity: parseNumericInput(line.quantity),
            unitPrice: parseNumericInput(line.unitPrice),
            discountPercent: totals.lines[index]?.effectiveDiscountPercent ?? 0,
            gstRate: product?.gstRate ?? 18,
            serialNumbers: line.trackSerials ? line.serials.filter(Boolean) : undefined,
          };
        }),
      });

      if (result.ok) {
        toast.success(`Quotation ${result.data.quotationNumber} updated`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant={triggerVariant} size={triggerSize}>
            <Pencil className="size-3.5" />
            {showLabel && <span>Edit quotation</span>}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-5 text-primary" />
            <span>Edit quotation {quotation.quotationNumber}</span>
          </DialogTitle>
          <DialogDescription>
            Update customer, items, prices, discounts, validity or terms.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Header metadata row */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Customer *</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setAddCustomerOpen(true)}
                >
                  <UserPlus className="size-3" /> Add customer
                </Button>
              </div>
              <SearchableSelect
                ariaLabel="Customer"
                options={customerOptions}
                value={customerId}
                onValueChange={setCustomerId}
                placeholder="Search customer by name or phone…"
                emptyMessage="No customers match"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-quote-date">Quotation date</Label>
                <Input
                  id="edit-quote-date"
                  type="date"
                  value={quotationDate}
                  onChange={(e) => setQuotationDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-quote-valid">Valid until</Label>
                <Input
                  id="edit-quote-valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Quotation status</Label>
              <Select
                value={status}
                onValueChange={(val: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED") => setStatus(val)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="ACCEPTED">Accepted</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {canSwitchMode && (
              <div className="space-y-1.5">
                <Label>Tax mode</Label>
                <Select value={taxMode} onValueChange={(val: "GST" | "NON_GST") => setTaxMode(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GST">Tax Invoice (GST)</SelectItem>
                    <SelectItem value="NON_GST">Non-Tax Invoice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Items Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Items &amp; Products *</Label>
              <span className="text-xs text-muted-foreground">
                {validLines.length} item{validLines.length === 1 ? "" : "s"}
              </span>
            </div>

            {lines.map((line) => {
              const product = productById.get(line.productId);
              return (
                <div key={line.key} className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                  <div className="flex items-center gap-2">
                    <SearchableSelect
                      ariaLabel="Product"
                      className="flex-1"
                      options={productOptions}
                      value={line.productId}
                      onValueChange={(value) => {
                        const p = productById.get(value);
                        setLine(line.key, {
                          productId: value,
                          unitPrice: String(p?.sellingPrice ?? 0),
                          trackSerials: p?.trackSerials ?? false,
                          serials: p?.trackSerials
                            ? Array.from({ length: parseNumericInput(line.quantity) }, () => "")
                            : [],
                        });
                      }}
                      placeholder="Select product…"
                      emptyMessage="No products match"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setLines((curr) => curr.filter((l) => l.key !== line.key))}
                      aria-label="Remove item"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-24">
                      <Label className="text-[11px] text-muted-foreground">Quantity</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                        onBlur={(e) => {
                          const newQty = tidyQuantityOnBlur(e.target.value);
                          const newSerials = line.trackSerials
                            ? [
                                ...line.serials,
                                ...Array.from(
                                  { length: Math.max(0, parseNumericInput(newQty) - line.serials.length) },
                                  () => "",
                                ),
                              ].slice(0, parseNumericInput(newQty))
                            : [];
                          setLine(line.key, { quantity: newQty, serials: newSerials });
                        }}
                      />
                    </div>

                    <div className="w-32">
                      <Label className="text-[11px] text-muted-foreground">Rate (₹)</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                        onBlur={(e) => setLine(line.key, { unitPrice: tidyAmountOnBlur(e.target.value) })}
                      />
                    </div>

                    {(() => {
                      const lineIdx = validLines.findIndex((l) => l.key === line.key);
                      const lineComputed = lineIdx >= 0 ? totals.lines[lineIdx] : undefined;
                      return (
                        <div className="ml-auto flex items-baseline gap-1.5 pt-4">
                          {lineComputed && lineComputed.totalDiscountAmount > 0 ? (
                            <span className="numeric text-xs text-muted-foreground line-through">
                              {formatCurrency(lineComputed.gross)}
                            </span>
                          ) : null}
                          <span className="numeric text-sm font-semibold">
                            {formatCurrency(
                              lineComputed
                                ? lineComputed.netTotal
                                : parseNumericInput(line.quantity) * parseNumericInput(line.unitPrice),
                            )}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {line.trackSerials ? (
                    <div className="space-y-1.5 pt-1">
                      <Label className="text-[11px] text-muted-foreground">Serial / IMEI numbers</Label>
                      {Array.from({ length: parseNumericInput(line.quantity) }, (_, index) => (
                        <Input
                          key={index}
                          className="h-8 font-mono text-xs"
                          placeholder={`Serial / IMEI #${index + 1}`}
                          value={line.serials[index] ?? ""}
                          onChange={(e) =>
                            setLine(line.key, {
                              serials: line.serials.map((s, i) => (i === index ? e.target.value : s)),
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="size-3.5" /> Add item
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddProductForLine(lines.find((l) => !l.productId)?.key ?? null);
                  setAddProductOpen(true);
                }}
              >
                <PackagePlus className="size-3.5" /> Add Product
              </Button>
            </div>
          </div>

          {/* Bill discount box */}
          {validLines.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Tag className="size-3.5 text-primary" />
                  <span>Overall Bill Discount</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 rounded border border-input bg-muted p-0.5">
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-0.5 text-xs font-semibold transition-colors",
                        billDiscountType === "%"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setBillDiscountType("%")}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-0.5 text-xs font-semibold transition-colors",
                        billDiscountType === "₹"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setBillDiscountType("₹")}
                    >
                      ₹
                    </button>
                  </div>
                  <Input
                    className="numeric h-8 w-24 text-right text-xs"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={billDiscountType === "%" ? "0 %" : "₹ 0"}
                    value={billDiscount}
                    onChange={(e) => setBillDiscount(e.target.value)}
                    onBlur={(e) =>
                      setBillDiscount(tidyDiscountOnBlur(e.target.value, billDiscountType, totals.grossSubtotal))
                    }
                  />
                </div>
              </div>
              {parseNumericInput(billDiscount) > 0 ? (
                <div className="space-y-1 border-t border-border/40 pt-1.5">
                  <label className="text-[11px] text-muted-foreground">
                    Discount remarks / reason (why discount is given)
                  </label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. Festival offer, bulk purchase discount, management approval..."
                    value={discountRemarks}
                    onChange={(e) => setDiscountRemarks(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Totals Summary */}
          {validLines.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-border/80 bg-muted/50 p-3 text-sm font-medium">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items subtotal</span>
                <span className="numeric">{formatCurrency(totals.grossSubtotal)}</span>
              </div>
              {totals.billDiscountTotal > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Bill discount ({billDiscountType === "%" ? `${parseNumericInput(billDiscount)}%` : "flat"})</span>
                  <span className="numeric">-{formatCurrency(totals.billDiscountTotal)}</span>
                </div>
              ) : null}
              {taxMode === "GST" ? (
                <>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Taxable value</span>
                    <span className="numeric">{formatCurrency(totals.taxableTotal)}</span>
                  </div>
                  {totals.cgstTotal > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>CGST</span>
                      <span className="numeric">{formatCurrency(totals.cgstTotal)}</span>
                    </div>
                  ) : null}
                  {totals.sgstTotal > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>SGST</span>
                      <span className="numeric">{formatCurrency(totals.sgstTotal)}</span>
                    </div>
                  ) : null}
                  {(totals as any).igstTotal > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>IGST</span>
                      <span className="numeric">{formatCurrency((totals as any).igstTotal)}</span>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/60">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span>Round off</span>
                  {isManualRoundOff ? (
                    <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      Manual
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  {isManualRoundOff ? (
                    <button
                      type="button"
                      className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                      onClick={() => {
                        setIsManualRoundOff(false);
                        setRoundOff("");
                      }}
                    >
                      Reset auto
                    </button>
                  ) : null}
                  <Input
                    className="h-7 w-24 text-right numeric text-xs font-mono"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={
                      isManualRoundOff
                        ? roundOff
                        : totals.roundOff !== 0
                        ? totals.roundOff > 0
                          ? `+${totals.roundOff.toFixed(2)}`
                          : totals.roundOff.toFixed(2)
                        : "0.00"
                    }
                    onChange={(e) => {
                      setIsManualRoundOff(true);
                      setRoundOff(e.target.value);
                    }}
                    aria-label="Manual round figure"
                  />
                </div>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
                <span>Quotation total</span>
                <span className="numeric text-primary">{formatCurrency(totals.totalAmount)}</span>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="edit-quote-notes">Notes (optional)</Label>
            <Textarea
              id="edit-quote-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes printed on the quotation"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-quote-terms">Terms &amp; conditions (optional)</Label>
            <Textarea
              id="edit-quote-terms"
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Payment terms, validity clauses, warranty terms"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !customerId || validLines.length === 0}>
            {pending ? "Saving changes…" : "Save changes"}
          </Button>
        </DialogFooter>

        <QuickAddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} onCreated={onProductCreated} />
        <QuickAddCustomerDialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen} onCreated={onCustomerCreated} />
      </DialogContent>
    </Dialog>
  );
}
