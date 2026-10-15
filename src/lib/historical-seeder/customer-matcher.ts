import { prisma } from "@/lib/prisma";
import { nextCustomerCode } from "@/lib/sequence";
import type { CustomerResolution, RawCustomerRow } from "./types";

/**
 * Extracts a 10-digit Indian phone number from text like "PHONE :9448142881 E - Way No."
 */
export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/(?:PHONE\s*:\s*|\+91\s*|\b)([6-9]\d{9})\b/i);
  return match ? match[1] : null;
}

/**
 * Cleans candidate customer name for storage.
 */
export function cleanCustomerName(candidate: string | null | undefined): string {
  if (!candidate) return "Unknown Customer";
  let name = candidate.trim();
  // If it's pure "PHONE :9448142881 E - Way No.", format as "Customer (9448142881)"
  const phone = extractPhone(name);
  if (phone && name.toUpperCase().includes("PHONE") && name.toUpperCase().includes("E - WAY")) {
    return `Customer (${phone})`;
  }
  // Strip trailing "E - Way No." artifacts if present
  name = name.replace(/\s*E\s*-\s*Way\s*No\.?\s*$/i, "").trim();
  return name || "Unknown Customer";
}

/**
 * Validates 15-character Indian GSTIN format.
 */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim().toUpperCase());
}

export class CustomerMatcher {
  private firmId: string;
  private branchId: string;
  private cacheByGstin = new Map<string, { id: string; code: string; name: string }>();
  private cacheByPhone = new Map<string, { id: string; code: string; name: string }>();
  private cacheByName = new Map<string, { id: string; code: string; name: string }>();

  constructor(firmId: string, branchId: string) {
    this.firmId = firmId;
    this.branchId = branchId;
  }

  /**
   * Pre-loads existing customers in the firm into memory caches.
   */
  async init(): Promise<void> {
    const existing = await prisma.customer.findMany({
      where: { firmId: this.firmId },
      select: { id: true, code: true, name: true, phone: true, gstin: true },
    });

    for (const c of existing) {
      if (c.gstin) this.cacheByGstin.set(c.gstin.toUpperCase(), { id: c.id, code: c.code, name: c.name });
      if (c.phone) this.cacheByPhone.set(c.phone.trim(), { id: c.id, code: c.code, name: c.name });
      this.cacheByName.set(c.name.trim().toLowerCase(), { id: c.id, code: c.code, name: c.name });
    }
  }

  /**
   * Matches an existing customer or creates a new one if all required fields are validated.
   */
  async resolveCustomer(
    candidateName: string,
    candidateGstin: string | null | undefined,
    dryRun = false,
  ): Promise<CustomerResolution> {
    const phone = extractPhone(candidateName);
    const cleanedName = cleanCustomerName(candidateName);
    const gstin = candidateGstin && isValidGstin(candidateGstin) ? candidateGstin.trim().toUpperCase() : undefined;

    // 1. Try match by GSTIN
    if (gstin && this.cacheByGstin.has(gstin)) {
      const match = this.cacheByGstin.get(gstin)!;
      return {
        status: "MATCHED",
        customerId: match.id,
        customerCode: match.code,
        customerName: match.name,
        gstin,
        phone: phone ?? undefined,
      };
    }

    // 2. Try match by phone
    if (phone && this.cacheByPhone.has(phone)) {
      const match = this.cacheByPhone.get(phone)!;
      return {
        status: "MATCHED",
        customerId: match.id,
        customerCode: match.code,
        customerName: match.name,
        phone,
        gstin,
      };
    }

    // 3. Try match by exact clean name
    const nameKey = cleanedName.toLowerCase();
    if (this.cacheByName.has(nameKey)) {
      const match = this.cacheByName.get(nameKey)!;
      return {
        status: "MATCHED",
        customerId: match.id,
        customerCode: match.code,
        customerName: match.name,
        phone: phone ?? undefined,
        gstin,
      };
    }

    // 4. Missing phone handling: provide company phone for internal and counter
    let effectivePhone = phone;
    let finalCleanedName = cleanedName;
    if (!effectivePhone) {
      if (candidateName.trim().toUpperCase().includes("TECHNIC TECHNOLOGY")) {
        effectivePhone = "08049001200";
        finalCleanedName = "Technic Technology (Internal Transfer)";
      } else if (candidateName.trim().toUpperCase() === "SELF") {
        effectivePhone = "9999999999";
        finalCleanedName = "Self / Retail Counter";
      }
    }

    if (!effectivePhone) {
      // In Technic ERP schema, Customer.phone is non-null String.
      return {
        status: "FAILED",
        customerName: cleanedName,
        gstin,
        error: `Cannot create customer without verified phone number (Customer.phone is required in schema)`,
      };
    }

    // 5. Create new customer
    if (dryRun) {
      const simulatedCode = `CUST-SIM-${effectivePhone.slice(-4)}`;
      const simulatedId = `sim_cust_${effectivePhone}`;
      this.cacheByPhone.set(effectivePhone, { id: simulatedId, code: simulatedCode, name: finalCleanedName });
      this.cacheByName.set(finalCleanedName.toLowerCase(), { id: simulatedId, code: simulatedCode, name: finalCleanedName });
      if (gstin) this.cacheByGstin.set(gstin, { id: simulatedId, code: simulatedCode, name: finalCleanedName });
      return {
        status: "CREATED",
        customerId: simulatedId,
        customerCode: simulatedCode,
        customerName: finalCleanedName,
        phone: effectivePhone,
        gstin,
      };
    }

    try {
      const code = await nextCustomerCode(this.firmId);
      const customer = await prisma.customer.create({
        data: {
          code,
          firmId: this.firmId,
          branchId: this.branchId,
          name: finalCleanedName,
          phone: effectivePhone,
          gstin: gstin ?? null,
          type: gstin ? "BUSINESS" : "RETAIL",
          notes: "Imported via historical invoice seeder",
        },
      });

      const entry = { id: customer.id, code: customer.code, name: customer.name };
      this.cacheByPhone.set(effectivePhone, entry);
      this.cacheByName.set(finalCleanedName.toLowerCase(), entry);
      if (gstin) this.cacheByGstin.set(gstin, entry);

      return {
        status: "CREATED",
        customerId: customer.id,
        customerCode: customer.code,
        customerName: customer.name,
        phone: customer.phone,
        gstin: customer.gstin ?? undefined,
      };
    } catch (err) {
      return {
        status: "FAILED",
        customerName: finalCleanedName,
        phone: effectivePhone,
        gstin,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Process all records from customers.csv
   */
  async processCustomerList(rows: RawCustomerRow[], dryRun = false): Promise<CustomerResolution[]> {
    const results: CustomerResolution[] = [];
    for (const row of rows) {
      const res = await this.resolveCustomer(row.customer_name, row.gstin, dryRun);
      results.push(res);
    }
    return results;
  }
}
