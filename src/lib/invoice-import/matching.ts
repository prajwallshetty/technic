import { compactKey, modelTokens, tokens } from "./normalize";

/**
 * Product matching for imported line items.
 *
 * Tiers, strongest first:
 *   1. exact identifier  — printed SKU / barcode / part / model number
 *   2. saved alias       — a reviewer previously mapped this exact text
 *                          (party-specific aliases win over firm-wide ones)
 *   3. normalised name   — same name once case, spacing and punctuation are ignored
 *   4. SKU in text       — a catalogue SKU/model number appears in the description
 *   5. fuzzy             — similarity ranking; never assigned automatically
 *
 * Only tiers 1–3 (and an unambiguous tier 4) assign a product. Fuzzy results
 * are offered as suggestions that a reviewer must confirm; confirming one
 * saves an alias so the same text matches exactly next time.
 *
 * Model codes are treated as identity: "B2036B20L" and "B2036B20R" (left vs
 * right terminal) look 95% alike to a string metric but are different
 * products, so candidates whose model codes conflict are capped well below
 * the suggestion threshold.
 */

export interface CatalogueProduct {
  id: string;
  sku: string;
  name: string;
  subName?: string | null;
  barcode?: string | null;
  modelNumber?: string | null;
  partNumber?: string | null;
  hsnCode?: string | null;
  brand?: string | null;
  status?: string;
}

export interface ProductAlias {
  aliasKey: string; // compactKey of the source text
  productId: string;
  /** "" = firm-wide; otherwise the counterparty key (GSTIN or normalised name). */
  partyKey: string;
}

export type MatchStatus = "MATCHED" | "SUGGESTED" | "AMBIGUOUS" | "UNMATCHED" | "NOT_APPLICABLE";

export type MatchMethod =
  | "EXACT_SKU"
  | "EXACT_BARCODE"
  | "EXACT_PART_OR_MODEL"
  | "ALIAS_PARTY"
  | "ALIAS_GLOBAL"
  | "NAME_NORMALIZED"
  | "SKU_IN_DESCRIPTION"
  | "FUZZY"
  | "MANUAL";

export interface MatchCandidate {
  productId: string;
  sku: string;
  name: string;
  score: number;
  reason: string;
}

export interface MatchResult {
  status: MatchStatus;
  productId: string | null;
  method: MatchMethod | null;
  confidence: number;
  candidates: MatchCandidate[];
  note?: string;
}

export const SUGGEST_THRESHOLD = 0.75;
const CANDIDATE_FLOOR = 0.45;

export interface MatchInput {
  kind: "ITEM" | "ADJUSTMENT";
  description: string | null;
  sku?: string | null;
  barcode?: string | null;
  partyKey?: string | null;
}

export class ProductMatcher {
  private bySku = new Map<string, CatalogueProduct[]>();
  private byBarcode = new Map<string, CatalogueProduct[]>();
  private byPartOrModel = new Map<string, CatalogueProduct[]>();
  private byName = new Map<string, CatalogueProduct[]>();
  private aliases = new Map<string, string>(); // `${partyKey}|${aliasKey}` → productId
  private products: Array<{ product: CatalogueProduct; key: string; models: string[]; bigrams: Map<string, number> }>;
  private byId: Map<string, CatalogueProduct>;

  constructor(catalogue: CatalogueProduct[], aliases: ProductAlias[] = []) {
    const active = catalogue.filter((p) => !p.status || p.status === "ACTIVE");
    this.byId = new Map(active.map((p) => [p.id, p]));
    const add = (map: Map<string, CatalogueProduct[]>, key: string, p: CatalogueProduct) => {
      if (!key) return;
      map.set(key, [...(map.get(key) ?? []), p]);
    };
    for (const p of active) {
      add(this.bySku, compactKey(p.sku), p);
      add(this.byBarcode, compactKey(p.barcode), p);
      add(this.byPartOrModel, compactKey(p.partNumber), p);
      add(this.byPartOrModel, compactKey(p.modelNumber), p);
      add(this.byName, compactKey(p.name), p);
      if (p.subName) add(this.byName, compactKey(`${p.name} ${p.subName}`), p);
    }
    for (const alias of aliases) {
      if (this.byId.has(alias.productId)) this.aliases.set(`${alias.partyKey}|${alias.aliasKey}`, alias.productId);
    }
    this.products = active.map((product) => {
      const text = [product.name, product.subName, product.modelNumber, product.partNumber].filter(Boolean).join(" ");
      const key = compactKey(text);
      return {
        product,
        key,
        models: unique([...modelTokens(text), ...modelTokens(product.sku)]),
        bigrams: bigramCounts(key),
      };
    });
  }

  match(input: MatchInput): MatchResult {
    if (input.kind === "ADJUSTMENT") {
      return { status: "NOT_APPLICABLE", productId: null, method: null, confidence: 1, candidates: [], note: "Discount/charge line — no product" };
    }
    const description = input.description ?? "";
    const descKey = compactKey(description);

    // 1. Printed identifiers.
    const identifierHits: Array<[string | null | undefined, Map<string, CatalogueProduct[]>, MatchMethod]> = [
      [input.sku, this.bySku, "EXACT_SKU"],
      [input.sku, this.byPartOrModel, "EXACT_PART_OR_MODEL"],
      [input.barcode, this.byBarcode, "EXACT_BARCODE"],
    ];
    for (const [value, map, method] of identifierHits) {
      const hits = value ? map.get(compactKey(value)) : undefined;
      if (hits?.length === 1) return matched(hits[0], method, 1);
      if (hits && hits.length > 1) return ambiguous(hits, `${method}: ${hits.length} products share "${value}"`);
    }

    if (!descKey) return { status: "UNMATCHED", productId: null, method: null, confidence: 0, candidates: [], note: "No description" };

    // 2. Saved aliases.
    if (input.partyKey) {
      const id = this.aliases.get(`${input.partyKey}|${descKey}`);
      if (id) return matched(this.byId.get(id)!, "ALIAS_PARTY", 1);
    }
    const globalAlias = this.aliases.get(`|${descKey}`);
    if (globalAlias) return matched(this.byId.get(globalAlias)!, "ALIAS_GLOBAL", 1);

    // 3. Normalised name / identifier equal to the whole description.
    for (const [map, method] of [
      [this.byName, "NAME_NORMALIZED"],
      [this.bySku, "EXACT_SKU"],
      [this.byPartOrModel, "EXACT_PART_OR_MODEL"],
    ] as const) {
      const hits = map.get(descKey);
      if (hits?.length === 1) return matched(hits[0], method, method === "NAME_NORMALIZED" ? 0.97 : 1);
      if (hits && hits.length > 1) return ambiguous(hits, `${hits.length} catalogue products have this exact name`);
    }

    // 4. A catalogue SKU / model / part number inside the description.
    const descTokens = new Set(tokens(description));
    const descModels = modelTokens(description);
    const embedded = new Map<string, CatalogueProduct>();
    for (const token of descTokens) {
      for (const map of [this.bySku, this.byPartOrModel]) {
        for (const p of map.get(token) ?? []) if (token.length >= 4) embedded.set(p.id, p);
      }
    }
    if (embedded.size === 1) {
      const [p] = embedded.values();
      const conflict = modelConflict(descModels, this.products.find((x) => x.product.id === p.id)!.models);
      if (!conflict) return matched(p, "SKU_IN_DESCRIPTION", 0.95);
    }

    // 5. Fuzzy ranking — suggestions only.
    const descBigrams = bigramCounts(descKey);
    const scored: MatchCandidate[] = [];
    for (const entry of this.products) {
      let score = dice(descBigrams, entry.bigrams);
      let reason = `text similarity ${(score * 100).toFixed(0)}%`;
      if (descModels.length && entry.models.length) {
        if (modelConflict(descModels, entry.models)) {
          score = Math.min(score, 0.5);
          reason += `; model code differs (${descModels.join(",")} vs ${entry.models.join(",")})`;
        } else {
          score = Math.min(1, score + 0.1);
          reason += "; model code matches";
        }
      }
      // Descriptions are often truncated by the printed column width.
      if (descKey.length >= 16 && entry.key.startsWith(descKey)) {
        score = Math.max(score, 0.9);
        reason += "; description is a truncated prefix of the catalogue name";
      }
      if (embedded.has(entry.product.id)) {
        score = Math.max(score, 0.85);
        reason += "; SKU appears in description";
      }
      if (score >= CANDIDATE_FLOOR) {
        scored.push({ productId: entry.product.id, sku: entry.product.sku, name: entry.product.name, score: round3(score), reason });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, 5);
    const best = candidates[0];
    if (best && best.score >= SUGGEST_THRESHOLD) {
      const runnerUp = candidates[1];
      const close = runnerUp && best.score - runnerUp.score < 0.05;
      return {
        status: close ? "AMBIGUOUS" : "SUGGESTED",
        productId: null,
        method: "FUZZY",
        confidence: best.score,
        candidates,
        note: close ? "Several catalogue products are similarly close — choose one" : "Best guess — confirm before approval",
      };
    }
    return {
      status: "UNMATCHED",
      productId: null,
      method: null,
      confidence: best?.score ?? 0,
      candidates,
      note: candidates.length ? "No candidate is close enough to suggest" : "No similar product in the catalogue",
    };
  }
}

function matched(p: CatalogueProduct, method: MatchMethod, confidence: number): MatchResult {
  return {
    status: "MATCHED",
    productId: p.id,
    method,
    confidence,
    candidates: [{ productId: p.id, sku: p.sku, name: p.name, score: confidence, reason: method }],
  };
}

function ambiguous(hits: CatalogueProduct[], note: string): MatchResult {
  return {
    status: "AMBIGUOUS",
    productId: null,
    method: null,
    confidence: 0.5,
    candidates: hits.slice(0, 5).map((p) => ({ productId: p.id, sku: p.sku, name: p.name, score: 0.5, reason: note })),
    note,
  };
}

function modelConflict(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const setB = new Set(b);
  return !a.some((m) => setB.has(m));
}

function bigramCounts(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let overlap = 0;
  let total = 0;
  for (const [, n] of a) total += n;
  for (const [, n] of b) total += n;
  if (total === 0) return 0;
  for (const [gram, n] of a) overlap += Math.min(n, b.get(gram) ?? 0);
  return (2 * overlap) / total;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Stable key for party-scoped aliases: GSTIN when known, else the normalised name. */
export function partyKeyFor(gstin: string | null | undefined, name: string | null | undefined): string {
  if (gstin) return `GSTIN:${gstin.toUpperCase()}`;
  const key = compactKey(name);
  return key ? `NAME:${key}` : "";
}
