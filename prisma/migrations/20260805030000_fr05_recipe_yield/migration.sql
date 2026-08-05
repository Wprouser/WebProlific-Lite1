BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Recipe] ADD [yieldQuantity] DECIMAL(12,4),
[yieldUnitId] NVARCHAR(1000);

-- AlterTable
ALTER TABLE [dbo].[RecipeLine] ADD [quantityUnitId] NVARCHAR(1000);

-- AddForeignKey
ALTER TABLE [dbo].[Recipe] ADD CONSTRAINT [Recipe_yieldUnitId_fkey] FOREIGN KEY ([yieldUnitId]) REFERENCES [dbo].[UnitOfMeasure]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecipeLine] ADD CONSTRAINT [RecipeLine_quantityUnitId_fkey] FOREIGN KEY ([quantityUnitId]) REFERENCES [dbo].[UnitOfMeasure]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

