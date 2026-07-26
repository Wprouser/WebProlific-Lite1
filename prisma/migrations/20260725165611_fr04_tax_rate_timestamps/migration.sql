/*
  Warnings:

  - Added the required column `updatedAt` to the `TaxRate` table without a default value. This is not possible if the table is not empty.

*/
BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- updatedAt gets a DEFAULT too (backfilling the 6 existing seeded rows to
-- "now"), even though Prisma Client normally sets @updatedAt itself on
-- writes going forward — a NOT NULL column needs something for the rows
-- that already exist.
ALTER TABLE [dbo].[TaxRate] ADD [createdAt] DATETIME2 NOT NULL CONSTRAINT [TaxRate_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
[updatedAt] DATETIME2 NOT NULL CONSTRAINT [TaxRate_updatedAt_df] DEFAULT CURRENT_TIMESTAMP;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
