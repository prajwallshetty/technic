"use client";

import * as React from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface SearchableOption {
  value: string;
  /** Primary label shown and matched against the typed query. */
  label: string;
  /** Secondary hint (phone, SKU, price…). Also searchable. */
  hint?: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /**
   * Optional "create" row rendered under the list, for when the record being
   * searched for does not exist yet. Receives the current filter text so the
   * new record can be pre-filled with what was typed.
   */
  onCreate?: (query: string) => void;
  /** Label for that row, e.g. "Add customer". Defaults to "Add new". */
  createLabel?: string;
}

/**
 * A filterable dropdown for long lists (customers, products, suppliers).
 * Plain input + listbox — works in dialogs on touch and desktop, and unlike a
 * Radix Select the list can be narrowed by typing.
 */
export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Search and select…",
  emptyMessage = "No matches found",
  className,
  disabled,
  ariaLabel,
  onCreate,
  createLabel = "Add new",
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = React.useMemo(() => {
    const cleaned = query.trim().toLowerCase();
    if (!cleaned) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(cleaned) ||
        (option.hint ?? "").toLowerCase().includes(cleaned),
    );
  }, [options, query]);

  // Close on outside click / Escape, reset query when reopening.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openMenu = () => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  };

  const commit = (optionValue: string) => {
    onValueChange(optionValue);
    setOpen(false);
    // Return focus to the trigger so keyboard flow continues in the dialog.
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
      </button>

      {open ? (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((i) => Math.max(i - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const option = filtered[activeIndex];
                    if (option) {
                      commit(option.value);
                    } else if (onCreate && query.trim()) {
                      // Nothing matches this search — create it instead.
                      setOpen(false);
                      onCreate(query.trim());
                    }
                  }
                }}
                placeholder="Type to filter…"
                className="h-8 pl-8 text-sm"
                aria-label={ariaLabel ? `${ariaLabel} search` : "Filter options"}
              />
            </div>
          </div>
          <div role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-y-auto scrollbar-thin p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => commit(option.value)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                    index === activeIndex ? "bg-accent text-accent-foreground" : "",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
                    ) : null}
                  </span>
                  {option.value === value ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                </button>
              )              )
            )}
          </div>
          {onCreate ? (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCreate(query.trim());
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-primary outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                <span className="truncate">
                  {query.trim() ? `${createLabel} “${query.trim()}”` : createLabel}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
