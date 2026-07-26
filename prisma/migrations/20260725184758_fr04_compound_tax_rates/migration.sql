BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[TaxRate] DROP CONSTRAINT [TaxRate_updatedAt_df];
ALTER TABLE [dbo].[TaxRate] ADD [isCompound] BIT NOT NULL CONSTRAINT [TaxRate_isCompound_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[TaxRateComponent] (
    [id] NVARCHAR(1000) NOT NULL,
    [taxRateId] NVARCHAR(1000) NOT NULL,
    [componentName] NVARCHAR(1000) NOT NULL,
    [componentRate] DECIMAL(5,2) NOT NULL,
    CONSTRAINT [TaxRateComponent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TaxRateComponent_taxRateId_idx] ON [dbo].[TaxRateComponent]([taxRateId]);

-- AddForeignKey
ALTER TABLE [dbo].[TaxRateComponent] ADD CONSTRAINT [TaxRateComponent_taxRateId_fkey] FOREIGN KEY ([taxRateId]) REFERENCES [dbo].[TaxRate]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
