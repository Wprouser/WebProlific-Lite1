BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[UnitOfMeasure] ADD [baseUnitId] NVARCHAR(1000),
[conversionFactor] DECIMAL(12,6);

-- Backfill: wire the same conversion relationships this migration's
-- DefaultUnitsListener rewrite now seeds for new outlets (Litre -> mL
-- x1000, Kilogram -> g x1000) onto every outlet that already existed
-- before this column did, per explicit sign-off — existing outlets should
-- match what new outlets get, not be permanently stuck without conversion.
-- Wrapped in EXEC(N'...') so SQL Server doesn't try to bind baseUnitId/
-- conversionFactor against the catalog at batch-compile time — they were
-- only just added above, in this same batch/transaction.
EXEC(N'
UPDATE l
SET l.[baseUnitId] = ml.[id], l.[conversionFactor] = 1000
FROM [dbo].[UnitOfMeasure] l
INNER JOIN [dbo].[UnitOfMeasure] ml
    ON ml.[outletId] = l.[outletId]
   AND ml.[name] = N''Millilitre''
WHERE l.[name] = N''Litre'';

UPDATE kg
SET kg.[baseUnitId] = g.[id], kg.[conversionFactor] = 1000
FROM [dbo].[UnitOfMeasure] kg
INNER JOIN [dbo].[UnitOfMeasure] g
    ON g.[outletId] = kg.[outletId]
   AND g.[name] = N''Gram''
WHERE kg.[name] = N''Kilogram'';
');

-- CreateIndex
CREATE NONCLUSTERED INDEX [UnitOfMeasure_baseUnitId_idx] ON [dbo].[UnitOfMeasure]([baseUnitId]);

-- AddForeignKey
ALTER TABLE [dbo].[UnitOfMeasure] ADD CONSTRAINT [UnitOfMeasure_baseUnitId_fkey] FOREIGN KEY ([baseUnitId]) REFERENCES [dbo].[UnitOfMeasure]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
