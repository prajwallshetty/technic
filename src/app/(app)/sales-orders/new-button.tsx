"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Tag, Trash2 } from "lucide-react";
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
import { createSalesOrderAction } from "./actions";

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  sellingPrice: number;
}

interface Line {
  key: number;
  productId: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  quantity: string;
  /** Raw input text — kept as a string so the field can be cleared while editing. */
  unitPrice: string;
  /** Raw input text — line discount value. */
  discount: string;
  /** Discount type: percent (%) or flat amount (₹) */
  discountType: DiscountType;
}

let lineKey = 0;

export function NewSalesOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [billDiscount, setBillDiscount] = useState("");
  const [billDiscountType, setBillDiscountType] = useState<DiscountType>("%");
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: "", quantity: "1", unitPrice: "0", discount: "0", discountType: "%" }]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || customers.length > 0) return;
    Promise.all([
      fetch("/api/customers").then((r) => (r.ok ? r.json() : { customers: [] })),
      fetch("/api/products").then((r) => (r.ok ? r.json() : { products: [] })),
    ])
      .then(([customersRes, productsRes]) => {
        setCustomers(customersRes.customers ?? []);
        setProducts(productsRes.products ?? []);
      })
      .catch(() => {
        setCustomers([]);
        setProducts([]);
      });
  }, [open, customers.length]);

  const productById = new Map(products.map((p) => [p.id, p]));

  const customerOptions: SearchableOption[] = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    hint: customer.phone,
  }));
  const productOptions: SearchableOption[] = products.map((product) => ({
    value: product.id,
    label: product.name,
    hint: `${product.sku} · ${formatCurrency(product.sellingPrice)}`,
  }));

  const setLine = (key: number, updates: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...updates } : line)));

  const addLine = () =>
    setLines((current) => [...current, { key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", discount: "0", discountType: "%" }]);

  const validLines = lines.filter((line) => line.productId);
  const totals = useMemo(() => {
    return computeDiscountSummary({
      lines: validLines.map((line) => ({
        quantity: parseNumericInput(line.quantity),
        unitPrice: parseNumericInput(line.unitPrice),
        discountType: line.discountType,
        discountValue: parseNumericInput(line.discount),
        gstRate: 18,
      })),
      billDiscount:
        parseNumericInput(billDiscount) > 0
          ? {
              type: billDiscountType,
              value: parseNumericInput(billDiscount),
            }
          : null,
      mode: "GST",
    });
  }, [validLines, billDiscount, billDiscountType]);

  const submit = () => {
    startTransition(async () => {
      const result = await createSalesOrderAction({
        customerId,
        expectedDate: expectedDate || null,
        notes: notes || null,
        lines: validLines.map((line, index) => ({
          productId: line.productId,
          quantity: parseNumericInput(line.quantity),
          unitPrice: parseNumericInput(line.unitPrice),
          discountPercent: totals.lines[index]?.effectiveDiscountPercent ?? 0,
          gstRate: 18,
        })),
      });
      if (result.ok) {
        toast.success(`Sales order ${result.data.orderNumber} created`);
        setOpen(false);
        setLines([{ key: (lineKey += 1), productId: "", quantity: "1", unitPrice: "0", discount: "0", discountType: "%" }]);
        setCustomerId("");
        setBillDiscount("");
        setExpectedDate("");
        setNotes("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New sales order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New sales order</DialogTitle>
          <DialogDescription>
            Reserve the customer&apos;s order now — it becomes an invoice when you bill it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer *</Label>
            <SearchableSelect
              ariaLabel="Customer"
              options={customerOptions}
              value={customerId}
              onValueChange={setCustomerId}
              placeholder="Search customer by name or phone…"
              emptyMessage="No customers match"
            />
          </div>

          <div className="space-y-2">
            <Label>Items *</Label>
            {lines.map((line) => {
              const product = productById.get(line.productId);
              return (
                <div key={line.key} className="space-y-1.5 rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <SearchableSelect
                      ariaLabel="Product"
                      className="flex-1"
                      options={productOptions}
                      value={line.productId}
                      onValueChange={(value) => {
                        const product = productById.get(value);
                        setLine(line.key, {
                          productId: value,
                          unitPrice: String(product?.sellingPrice ?? 0),
                        });
                      }}
                      placeholder="Search product…"
                      emptyMessage="No products match"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      aria-label="Remove line"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input
                        className="numeric h-8"
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                        onBlur={(e) => setLine(line.key, { quantity: tidyQuantityOnBlur(e.target.value) })}
                        aria-label="Quantity"
                      />
                    </div>
                    <div className="w-32">
                      <Label className="text-xs text-muted-foreground">Disc</Label>
                      <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
                        <Input
                          className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0 numeric px-2 text-right text-xs"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0"
                          value={line.discount}
                          onChange={(e) => setLine(line.key, { discount: e.target.value })}
                          onBlur={(e) =>
                            setLine(line.key, {
                              discount: tidyDiscountOnBlur(
                                e.target.value,
                                line.discountType,
                                parseNumericInput(line.unitPrice) * parseNumericInput(line.quantity),
                              ),
                            })
                          }
                          aria-label="Discount"
                        />
                        <div className="flex items-center gap-0.5 bg-muted/70 p-0.5 rounded mr-1">
                          <button
                            type="button"
                            className={cn(
                              "px-1.5 py-0.5 text-[10px] font-bold rounded transition-colors",
                              line.discountType === "%"
                                ? "bg-background text-foreground shadow-xs"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => setLine(line.key, { discountType: "%" })}
                            title="Percent"
                          >
                            %
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "px-1.5 py-0.5 text-[10px] font-bold rounded transition-colors",
                              line.discountType === "₹"
                                ? "bg-background text-foreground shadow-xs"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => setLine(line.key, { discountType: "₹" })}
                            title="Rupees"
                          >
                            ₹
                          </button>
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const lineIdx = validLines.findIndex((l) => l.key === line.key);
                      const lineComputed = lineIdx >= 0 ? totals.lines[lineIdx] : undefined;
                      return (
                        <div className="ml-auto pt-5 flex items-baseline gap-1.5">
                          {lineComputed && lineComputed.totalDiscountAmount > 0 ? (
                            <span className="text-xs text-muted-foreground line-through numeric">
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
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus /> Add item
            </Button>
          </div>

          {validLines.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Tag className="size-3.5 text-primary" />
                  <span>Order Discount</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded border border-input">
                    <button
                      type="button"
                      className={cn(
                        "px-2 py-0.5 text-xs font-semibold rounded transition-colors",
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
                        "px-2 py-0.5 text-xs font-semibold rounded transition-colors",
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
                    className="h-8 w-24 text-right numeric text-xs"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={billDiscountType === "%" ? "0 %" : "₹ 0"}
                    value={billDiscount}
                    onChange={(e) => setBillDiscount(e.target.value)}
                    onBlur={(e) =>
                      setBillDiscount(
                        tidyDiscountOnBlur(e.target.value, billDiscountType, totals.grossSubtotal),
                      )
                    }
                    aria-label="Overall order discount"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {validLines.length > 0 ? (
            <div className="rounded-lg bg-muted p-3 space-y-1.5 text-sm font-medium">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items subtotal</span>
                <span className="numeric">{formatCurrency(totals.grossSubtotal)}</span>
              </div>
              {totals.lineDiscountTotal > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Item discount(s)</span>
                  <span className="numeric">-{formatCurrency(totals.lineDiscountTotal)}</span>
                </div>
              ) : null}
              {totals.billDiscountTotal > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Order discount ({billDiscountType === "%" ? `${parseNumericInput(billDiscount)}%` : "flat"})</span>
                  <span className="numeric">-{formatCurrency(totals.billDiscountTotal)}</span>
                </div>
              ) : null}
              {totals.totalDiscount > 0 && totals.lineDiscountTotal > 0 && totals.billDiscountTotal > 0 ? (
                <div className="flex justify-between font-medium text-emerald-600 dark:text-emerald-400 border-t border-dashed border-border pt-1">
                  <span>Total discount</span>
                  <span className="numeric">-{formatCurrency(totals.totalDiscount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
                <span>Order total</span>
                <span className="numeric">{formatCurrency(totals.totalAmount)}</span>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="so-expected">Expected by (optional)</Label>
              <Input
                id="so-expected"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-notes">Notes (optional)</Label>
              <Input
                id="so-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery instructions…"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !customerId || validLines.length === 0}
          >
            <ClipboardList /> {pending ? "Saving…" : "Create order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
