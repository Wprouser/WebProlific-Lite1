BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[StockTransaction] ALTER COLUMN [performedById] NVARCHAR(1000) NULL;

-- CreateTable
CREATE TABLE [dbo].[Sale] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [menuItemId] NVARCHAR(1000) NOT NULL,
    [quantitySold] DECIMAL(10,3) NOT NULL,
    [recipeVersionUsed] INT,
    [posReferenceId] NVARCHAR(1000) NOT NULL,
    [sourceType] NVARCHAR(1000) NOT NULL CONSTRAINT [Sale_sourceType_df] DEFAULT 'WEBHOOK',
    [importBatchId] NVARCHAR(1000),
    [isVoid] BIT NOT NULL CONSTRAINT [Sale_isVoid_df] DEFAULT 0,
    [voidedAt] DATETIME2,
    [saleTimestamp] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Sale_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Sale_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Sale_posReferenceId_key] UNIQUE NONCLUSTERED ([posReferenceId])
);

-- CreateTable
CREATE TABLE [dbo].[SaleImportBatch] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [fileName] NVARCHAR(1000),
    [importedById] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [SaleImportBatch_status_df] DEFAULT 'STAGED',
    [totalRows] INT NOT NULL,
    [processedRows] INT NOT NULL CONSTRAINT [SaleImportBatch_processedRows_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SaleImportBatch_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [processedAt] DATETIME2,
    CONSTRAINT [SaleImportBatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SaleImportRow] (
    [id] NVARCHAR(1000) NOT NULL,
    [batchId] NVARCHAR(1000) NOT NULL,
    [rowNumber] INT NOT NULL,
    [rawMenuItemName] NVARCHAR(1000) NOT NULL,
    [rawSku] NVARCHAR(1000),
    [quantitySold] DECIMAL(10,3) NOT NULL,
    [saleDate] DATETIME2 NOT NULL,
    [posReferenceRaw] NVARCHAR(1000),
    [matchedMenuItemId] NVARCHAR(1000),
    [matchStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [SaleImportRow_matchStatus_df] DEFAULT 'UNMATCHED',
    [saleId] NVARCHAR(1000),
    [skipReason] NVARCHAR(1000),
    CONSTRAINT [SaleImportRow_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SaleImportRow_batchId_rowNumber_key] UNIQUE NONCLUSTERED ([batchId],[rowNumber])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Sale_outletId_saleTimestamp_idx] ON [dbo].[Sale]([outletId], [saleTimestamp]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Sale_menuItemId_idx] ON [dbo].[Sale]([menuItemId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Sale_importBatchId_idx] ON [dbo].[Sale]([importBatchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Sale_outletId_recipeVersionUsed_idx] ON [dbo].[Sale]([outletId], [recipeVersionUsed]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SaleImportBatch_outletId_createdAt_idx] ON [dbo].[SaleImportBatch]([outletId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SaleImportRow_batchId_matchStatus_idx] ON [dbo].[SaleImportRow]([batchId], [matchStatus]);

-- AddForeignKey
ALTER TABLE [dbo].[Sale] ADD CONSTRAINT [Sale_outletId_fkey] FOREIGN KEY ([outletId]) REFERENCES [dbo].[Outlet]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Sale] ADD CONSTRAINT [Sale_menuItemId_fkey] FOREIGN KEY ([menuItemId]) REFERENCES [dbo].[MenuItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Sale] ADD CONSTRAINT [Sale_importBatchId_fkey] FOREIGN KEY ([importBatchId]) REFERENCES [dbo].[SaleImportBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SaleImportBatch] ADD CONSTRAINT [SaleImportBatch_outletId_fkey] FOREIGN KEY ([outletId]) REFERENCES [dbo].[Outlet]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SaleImportRow] ADD CONSTRAINT [SaleImportRow_batchId_fkey] FOREIGN KEY ([batchId]) REFERENCES [dbo].[SaleImportBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SaleImportRow] ADD CONSTRAINT [SaleImportRow_matchedMenuItemId_fkey] FOREIGN KEY ([matchedMenuItemId]) REFERENCES [dbo].[MenuItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

