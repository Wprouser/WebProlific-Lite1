BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[GRN] DROP CONSTRAINT [GRN_adjustmentAmount_df];
ALTER TABLE [dbo].[GRN] DROP COLUMN [adjustmentAmount];
ALTER TABLE [dbo].[GRN] ADD [discountAmount] DECIMAL(12,2) NOT NULL CONSTRAINT [GRN_discountAmount_df] DEFAULT 0,
[otherChargesAmount] DECIMAL(12,2) NOT NULL CONSTRAINT [GRN_otherChargesAmount_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[PurchaseOrder] DROP CONSTRAINT [PurchaseOrder_adjustmentAmount_df];
ALTER TABLE [dbo].[PurchaseOrder] DROP COLUMN [adjustmentAmount];
ALTER TABLE [dbo].[PurchaseOrder] ADD [discountAmount] DECIMAL(12,2) NOT NULL CONSTRAINT [PurchaseOrder_discountAmount_df] DEFAULT 0,
[otherChargesAmount] DECIMAL(12,2) NOT NULL CONSTRAINT [PurchaseOrder_otherChargesAmount_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
