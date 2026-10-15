-- Soft delete for firms: a non-null deletedAt means the firm sits in the trash
-- and is hidden everywhere; it is purged for good 100 days later.

-- AlterTable
ALTER TABLE "firms" ADD COLUMN "deletedAt" TIMESTAMP(3);
