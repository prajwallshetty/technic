-- Customer and supplier codes are unique per firm, not globally, so two
-- organizations can both use code "C001".
--
-- Guarded with IF [NOT] EXISTS so it applies cleanly both to a fresh database
-- built from 0_init (which still creates the old global unique indexes) and to
-- the already-migrated database where these indexes were changed by hand.

DROP INDEX IF EXISTS "customers_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "customers_firmId_code_key" ON "customers"("firmId", "code");

DROP INDEX IF EXISTS "suppliers_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_firmId_code_key" ON "suppliers"("firmId", "code");
