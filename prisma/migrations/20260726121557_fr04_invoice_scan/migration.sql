BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[InvoiceScan] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [fileUrl] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [InvoiceScan_status_df] DEFAULT 'PROCESSING',
    [extractedData] NVARCHAR(max),
    [failureReason] NVARCHAR(1000),
    [createdById] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InvoiceScan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InvoiceScan_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InvoiceScan_outletId_createdAt_idx] ON [dbo].[InvoiceScan]([outletId], [createdAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
