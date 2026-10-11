"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Plus,
  Tag,
  Trash2,
  PackagePlus,
  UserPlus,
  Truck,
  FileText,
  User,
  ShoppingBag,
  AlertCircle,
} from "lucide-react";
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
import { updateInvoiceAction } from "./actions";

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
  email?: string | null;
  gstin?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

interface Line {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  trackSerials: boolean;
  serials: string[];
}

export interface InvoiceProp {
  id: string;
  invoiceNumber: string;
  kind: "TAX_INVOICE" | "NON_GST_BILL" | string;
  taxMode: "GST" | "NON_GST" | string;
  status: string;
  invoiceDate: Date | string;
  dueDate?: Date | string | null;
  billToName: string;
  billToPhone?: string | null;
  billToEmail?: string | null;
  billToAddress?: string | null;
  billToGstin?: string | null;
  placeOfSupply?: string | null;
  notes?: string | null;
  terms?: string | null;
  dispatchThrough?: string | null;
  vehicleNumber?: string | null;
  ewayBillNumber?: string | null;
  buyerOrderNo?: string | null;
  discountRemarks?: string | null;
  customerId: string;
  customer?: {
    id?: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    gstin?: string | null;
    addressLine?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  } | null;
  amountPaid: number | string | unknown;
  totalAmount: number | string | unknown;
  amountDue: number | string | unknown;
  salesReturns?: Array<{ id: string }>;
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

export function EditInvoiceButton({
  invoice,
  defaultOpen = false,
  triggerVariant = "outline",
  triggerSize = "sm",
  showLabel = true,
  children,
}: {
  invoice: InvoiceProp;
  defaultOpen?: boolean;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm" | "icon" | "icon-sm";
  showLabel?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<"items" | "billing" | "dispatch">("items");

  const isGst = invoice.taxMode === "GST";
  const hasReturns = Boolean(invoice.salesReturns && invoice.salesReturns.length > 0);

  // Billing & customer state
  const [customerId, setCustomerId] = useState(invoice.customerId);
  const [billToName, setBillToName] = useState(invoice.billToName ?? "");
  const [billToPhone, setBillToPhone] = useState(invoice.billToPhone ?? "");
  const [billToEmail, setBillToEmail] = useState(invoice.billToEmail ?? "");
  const [billToAddress, setBillToAddress] = useState(invoice.billToAddress ?? "");
  const [billToGstin, setBillToGstin] = useState(invoice.billToGstin ?? "");
  const [placeOfSupply, setPlaceOfSupply] = useState(invoice.placeOfSupply ?? "");

  // Dates & Notes state
  const [invoiceDate, setInvoiceDate] = useState(formatDateForInput(invoice.invoiceDate));
  const [dueDate, setDueDate] = useState(formatDateForInput(invoice.dueDate));
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [terms, setTerms] = useState(invoice.terms ?? "");

  // Dispatch state
  const [dispatchThrough, setDispatchThrough] = useState(invoice.dispatchThrough ?? "");
  const [vehicleNumber, setVehicleNumber] = useState(invoice.vehicleNumber ?? "");
  const [ewayBillNumber, setEwayBillNumber] = useState(invoice.ewayBillNumber ?? "");
  const [buyerOrderNo, setBuyerOrderNo] = useState(invoice.buyerOrderNo ?? "");

  // Line items state
  const initialDiscount = Number((invoice as any).discountAmount) > 0 ? String(Number((invoice as any).discountAmount)) : "";
  const [billDiscount, setBillDiscount] = useState(initialDiscount);
  const [billDiscountType, setBillDiscountType] = useState<DiscountType>("₹");
  const [discountRemarks, setDiscountRemarks] = useState(invoice.discountRemarks ?? "");
  const initialRoundOff = (invoice as any).roundOff != null && Number((invoice as any).roundOff) !== 0 ? String(Number((invoice as any).roundOff)) : "";
  const [roundOff, setRoundOff] = useState(initialRoundOff);
  const [isManualRoundOff, setIsManualRoundOff] = useState(Boolean(initialRoundOff));

  const [customers, setCustomers] = useState<CustomerOption[]>(() => {
    if (invoice.customer) {
      return [{
        id: invoice.customerId,
        name: invoice.customer.name,
        phone: invoice.customer.phone ?? "",
        email: invoice.customer.email,
        gstin: invoice.customer.gstin,
        addressLine: invoice.customer.addressLine,
        city: invoice.customer.city,
        state: invoice.customer.state,
        pincode: invoice.customer.pincode,
      }];
    }
    return [];
  });

  const [products, setProducts] = useState<ProductOption[]>(() => {
    const list: ProductOption[] = [];
    for (const line of invoice.lines) {
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
    return invoice.lines.map((l, index) => {
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
    setBillToName(created.name);
    setBillToPhone(created.phone);
  };

  const onSelectCustomer = (id: string) => {
    setCustomerId(id);
    const chosen = customers.find((c) => c.id === id);
    if (chosen) {
      setBillToName(chosen.name);
      if (chosen.phone) setBillToPhone(chosen.phone);
      if (chosen.email) setBillToEmail(chosen.email);
      if (chosen.gstin) setBillToGstin(chosen.gstin);
      const addr = [chosen.addressLine, chosen.city, chosen.state, chosen.pincode].filter(Boolean).join(", ");
      if (addr) setBillToAddress(addr);
      if (chosen.state || chosen.city) setPlaceOfSupply(chosen.state ?? chosen.city ?? "");
    }
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
      mode: isGst ? "GST" : "NON_GST",
      manualRoundOff: isManualRoundOff ? parseNumericInput(roundOff) : undefined,
    });
  }, [validLines, billDiscount, billDiscountType, isGst, productById, isManualRoundOff, roundOff]);

  const paidAmount = Number(invoice.amountPaid);
  const currentTotal = hasReturns ? Number(invoice.totalAmount) : totals.totalAmount;
  const newDueAmount = Math.max(0, currentTotal - paidAmount);

  const submit = () => {
    startTransition(async () => {
      const result = await updateInvoiceAction({
        invoiceId: invoice.id,
        customerId: customerId || undefined,
        invoiceDate: invoiceDate || null,
        dueDate: dueDate || null,
        billToName: billToName || undefined,
        billToPhone: billToPhone || null,
        billToEmail: billToEmail || null,
        billToAddress: billToAddress || null,
        billToGstin: billToGstin || null,
        placeOfSupply: placeOfSupply || null,
        notes: notes || null,
        terms: terms || null,
        dispatchThrough: dispatchThrough || null,
        vehicleNumber: vehicleNumber || null,
        ewayBillNumber: ewayBillNumber || null,
        buyerOrderNo: buyerOrderNo || null,
        discountRemarks: discountRemarks || null,
        manualRoundOff: totals.roundOff,
        lines: hasReturns
          ? undefined
          : validLines.map((line, index) => {
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
        toast.success(`Invoice ${result.data.invoiceNumber} updated`);
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
            {showLabel && <span>Edit invoice</span>}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-5 text-primary" />
            <span>Edit invoice {invoice.invoiceNumber}</span>
          </DialogTitle>
          <DialogDescription>
            Modify items, customer billing information, dates, terms, or dispatch details.
          </DialogDescription>
        </DialogHeader>

        {/* Navigation Tabs */}
        <div className="flex border-b border-border">
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              activeTab === "items"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("items")}
          >
            <ShoppingBag className="size-4" />
            <span>Items &amp; Pricing</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
              {validLines.length}
            </span>
          </button>

          <button
            type="button"
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              activeTab === "billing"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("billing")}
          >
            <User className="size-4" />
            <span>Customer &amp; Billing</span>
          </button>

          <button
            type="button"
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              activeTab === "dispatch"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("dispatch")}
          >
            <Truck className="size-4" />
            <span>Dispatch &amp; Notes</span>
          </button>
        </div>

        {/* Tab 1: Items & Pricing */}
        {activeTab === "items" && (
          <div className="space-y-4 pt-2">
            {hasReturns && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-semibold">Items locked due to sales return</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400/90">
                    A return has already been processed on this invoice. Line items and quantities are locked
                    to protect accounting ledger integrity. You can still modify billing, dates, and dispatch info.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Line Items *</Label>
                <span className="text-xs text-muted-foreground">
                  Mode: <span className="font-medium text-foreground">{isGst ? "Tax Invoice (GST)" : "Non-Tax Invoice"}</span>
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
                        disabled={hasReturns}
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
                      {!hasReturns && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => setLines((curr) => curr.filter((l) => l.key !== line.key))}
                          aria-label="Remove item"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-24">
                        <Label className="text-[11px] text-muted-foreground">Quantity</Label>
                        <Input
                          className="numeric h-8"
                          type="number"
                          min="1"
                          disabled={hasReturns}
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
                          disabled={hasReturns}
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
                            disabled={hasReturns}
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

              {!hasReturns && (
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
              )}
            </div>

            {/* Bill discount box */}
            {!hasReturns && validLines.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
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
                    <Label className="text-[11px] text-muted-foreground">
                      Discount remarks / reason (why discount is given)
                    </Label>
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

            {/* Live Financial Breakdown Card */}
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
              {isGst ? (
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
                    disabled={hasReturns}
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
                <span>Invoice Total</span>
                <span className="numeric text-primary">{formatCurrency(currentTotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground pt-0.5">
                <span>Amount Paid</span>
                <span className="numeric">{formatCurrency(paidAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold text-sm pt-0.5">
                <span>Balance Due</span>
                <span className={cn("numeric", newDueAmount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                  {formatCurrency(newDueAmount)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Customer & Billing */}
        {activeTab === "billing" && (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Assigned Customer</Label>
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
                onValueChange={onSelectCustomer}
                placeholder="Search customer…"
                emptyMessage="No customers match"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="inv-bill-name">Bill to name *</Label>
                <Input
                  id="inv-bill-name"
                  value={billToName}
                  onChange={(e) => setBillToName(e.target.value)}
                  placeholder="Customer / Company name"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inv-bill-phone">Phone number</Label>
                <Input
                  id="inv-bill-phone"
                  value={billToPhone}
                  onChange={(e) => setBillToPhone(e.target.value)}
                  placeholder="+91..."
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inv-bill-email">Email address</Label>
                <Input
                  id="inv-bill-email"
                  type="email"
                  value={billToEmail}
                  onChange={(e) => setBillToEmail(e.target.value)}
                  placeholder="customer@domain.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inv-bill-gstin">GSTIN</Label>
                <Input
                  id="inv-bill-gstin"
                  className="uppercase"
                  value={billToGstin}
                  onChange={(e) => setBillToGstin(e.target.value)}
                  placeholder="29AAAAA0000A1Z5"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-bill-address">Billing address</Label>
              <Textarea
                id="inv-bill-address"
                rows={2}
                value={billToAddress}
                onChange={(e) => setBillToAddress(e.target.value)}
                placeholder="Street address, City, State, PIN"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-supply">Place of supply</Label>
              <Input
                id="inv-supply"
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
                placeholder="State name (e.g. Karnataka)"
              />
            </div>
          </div>
        )}

        {/* Tab 3: Dispatch & Dates */}
        {activeTab === "dispatch" && (
          <div className="space-y-4 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="inv-date">Invoice date</Label>
                <Input
                  id="inv-date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inv-due-date">Due date</Label>
                <Input
                  id="inv-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-card p-3 shadow-xs">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Truck className="size-3.5 text-primary" />
                <span>Dispatch &amp; E-way details</span>
              </h4>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-dispatch">Dispatched through</Label>
                  <Input
                    id="inv-dispatch"
                    value={dispatchThrough}
                    onChange={(e) => setDispatchThrough(e.target.value)}
                    placeholder="Transporter / Delivery vehicle"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="inv-vehicle">Vehicle number</Label>
                  <Input
                    id="inv-vehicle"
                    className="uppercase"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                    placeholder="KA01AB1234"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="inv-eway">E-way bill number</Label>
                  <Input
                    id="inv-eway"
                    value={ewayBillNumber}
                    onChange={(e) => setEwayBillNumber(e.target.value)}
                    placeholder="12-digit number"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="inv-buyer-order">Buyer&apos;s order no.</Label>
                  <Input
                    id="inv-buyer-order"
                    value={buyerOrderNo}
                    onChange={(e) => setBuyerOrderNo(e.target.value)}
                    placeholder="PO reference number"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-notes">Invoice notes</Label>
              <Textarea
                id="inv-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Printed notes for the buyer"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-terms">Terms &amp; conditions</Label>
              <Textarea
                id="inv-terms"
                rows={2}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Custom terms for this invoice"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !billToName.trim() || (!hasReturns && validLines.length === 0)}>
            {pending ? "Saving changes…" : "Save changes"}
          </Button>
        </DialogFooter>

        <QuickAddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} onCreated={onProductCreated} />
        <QuickAddCustomerDialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen} onCreated={onCustomerCreated} />
      </DialogContent>
    </Dialog>
  );
}
