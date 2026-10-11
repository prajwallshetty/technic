-- Additive, non-destructive: discount remarks explaining why discount is given, printed on the invoice PDF.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discountRemarks" TEXT;
