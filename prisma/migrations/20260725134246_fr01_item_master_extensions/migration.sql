BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Item] ADD [defaultTaxRateId] NVARCHAR(1000),
[purchaseGLAccount] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[ItemImage] (
    [id] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000) NOT NULL,
    [url] NVARCHAR(1000) NOT NULL,
    [isPrimary] BIT NOT NULL CONSTRAINT [ItemImage_isPrimary_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [ItemImage_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ItemImage_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ItemImage_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ItemImage_itemId_idx] ON [dbo].[ItemImage]([itemId]);

-- AddForeignKey
ALTER TABLE [dbo].[ItemImage] ADD CONSTRAINT [ItemImage_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[Item]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
