BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[TaxRate] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [ratePercent] DECIMAL(5,2) NOT NULL,
    [isDefault] BIT NOT NULL CONSTRAINT [TaxRate_isDefault_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [TaxRate_isActive_df] DEFAULT 1,
    [countryCode] NVARCHAR(1000),
    CONSTRAINT [TaxRate_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TaxRate_outletId_isActive_idx] ON [dbo].[TaxRate]([outletId], [isActive]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
