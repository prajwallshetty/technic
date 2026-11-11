-- Brings the migration history level with prisma/schema.prisma. These objects
-- already exist on databases that were created from prisma/full_schema.sql;
-- databases built from the migrations alone were missing them.
-- Idempotent: the local PGlite setup re-applies every migration on start-up.

DO $$ BEGIN
  CREATE TYPE "AccessView" AS ENUM ('COMBINED', 'GST_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accessView" "AccessView" NOT NULL DEFAULT 'COMBINED';

ALTER TABLE "quotation_lines" ADD COLUMN IF NOT EXISTS "serialNumbers" TEXT[];

ALTER TABLE "goods_receipts" DROP CONSTRAINT IF EXISTS "goods_receipts_poId_fkey";
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_poId_fkey"
  FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
