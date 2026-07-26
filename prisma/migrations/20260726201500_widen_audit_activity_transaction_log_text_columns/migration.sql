BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[ActivityLog] ALTER COLUMN [metadata] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[AuditLog] ALTER COLUMN [before] NVARCHAR(max) NULL;
ALTER TABLE [dbo].[AuditLog] ALTER COLUMN [after] NVARCHAR(max) NULL;

-- AlterTable
ALTER TABLE [dbo].[TransactionLog] ALTER COLUMN [oldValue] NVARCHAR(max) NULL;
ALTER TABLE [dbo].[TransactionLog] ALTER COLUMN [newValue] NVARCHAR(max) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
