BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Alert] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000),
    [type] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Alert_status_df] DEFAULT 'OPEN',
    [message] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Alert_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [acknowledgedAt] DATETIME2,
    [resolvedAt] DATETIME2,
    CONSTRAINT [Alert_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Alert_outletId_status_idx] ON [dbo].[Alert]([outletId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Alert_itemId_type_status_createdAt_idx] ON [dbo].[Alert]([itemId], [type], [status], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[Alert] ADD CONSTRAINT [Alert_outletId_fkey] FOREIGN KEY ([outletId]) REFERENCES [dbo].[Outlet]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Alert] ADD CONSTRAINT [Alert_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[Item]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

