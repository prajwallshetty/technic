-- Additive, non-destructive: discount remarks explaining why discount is given, printed on PDFs.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discountRemarks" TEXT;
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "discountRemarks" TEXT;
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "discountRemarks" TEXT;
