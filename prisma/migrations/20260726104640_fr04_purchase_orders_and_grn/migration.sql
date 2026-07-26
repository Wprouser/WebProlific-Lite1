BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[PurchaseOrder] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [supplierId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PurchaseOrder_status_df] DEFAULT 'DRAFT',
    [expectedDeliveryDate] DATETIME2,
    [createdById] NVARCHAR(1000) NOT NULL,
    [approvedById] NVARCHAR(1000),
    [approvedAt] DATETIME2,
    [currencyCode] NVARCHAR(1000) NOT NULL CONSTRAINT [PurchaseOrder_currencyCode_df] DEFAULT 'SAR',
    [exchangeRateToBase] DECIMAL(12,6) NOT NULL CONSTRAINT [PurchaseOrder_exchangeRateToBase_df] DEFAULT 1,
    [isTaxInclusive] BIT NOT NULL CONSTRAINT [PurchaseOrder_isTaxInclusive_df] DEFAULT 0,
    [adjustmentAmount] DECIMAL(12,2) NOT NULL CONSTRAINT [PurchaseOrder_adjustmentAmount_df] DEFAULT 0,
    [subtotal] DECIMAL(12,2) NOT NULL,
    [taxAmount] DECIMAL(12,2) NOT NULL,
    [totalValue] DECIMAL(12,2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PurchaseOrder_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PurchaseOrder_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[POLine] (
    [id] NVARCHAR(1000) NOT NULL,
    [purchaseOrderId] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000) NOT NULL,
    [orderedQty] DECIMAL(10,3) NOT NULL,
    [expectedPrice] DECIMAL(12,2) NOT NULL,
    [taxRateId] NVARCHAR(1000),
    [taxRate] DECIMAL(5,2) NOT NULL CONSTRAINT [POLine_taxRate_df] DEFAULT 0,
    [lineSubtotal] DECIMAL(12,2) NOT NULL,
    [lineTaxAmount] DECIMAL(12,2) NOT NULL,
    [lineTotal] DECIMAL(12,2) NOT NULL,
    [receivedQty] DECIMAL(10,3) NOT NULL CONSTRAINT [POLine_receivedQty_df] DEFAULT 0,
    CONSTRAINT [POLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[POLineTaxComponent] (
    [id] NVARCHAR(1000) NOT NULL,
    [poLineId] NVARCHAR(1000) NOT NULL,
    [componentName] NVARCHAR(1000) NOT NULL,
    [componentRate] DECIMAL(5,2) NOT NULL,
    [componentAmount] DECIMAL(12,2) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [POLineTaxComponent_sortOrder_df] DEFAULT 0,
    CONSTRAINT [POLineTaxComponent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[GRN] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [purchaseOrderId] NVARCHAR(1000),
    [supplierId] NVARCHAR(1000) NOT NULL,
    [receivedById] NVARCHAR(1000) NOT NULL,
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [GRN_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [currencyCode] NVARCHAR(1000) NOT NULL,
    [exchangeRateToBase] DECIMAL(12,6) NOT NULL,
    [isTaxInclusive] BIT NOT NULL CONSTRAINT [GRN_isTaxInclusive_df] DEFAULT 0,
    [adjustmentAmount] DECIMAL(12,2) NOT NULL CONSTRAINT [GRN_adjustmentAmount_df] DEFAULT 0,
    [subtotal] DECIMAL(12,2) NOT NULL,
    [taxAmount] DECIMAL(12,2) NOT NULL,
    [totalValue] DECIMAL(12,2) NOT NULL,
    [invoiceNumber] NVARCHAR(1000),
    [invoiceScanUrl] NVARCHAR(1000),
    [invoiceScanStatus] NVARCHAR(1000),
    [varianceFlagged] BIT NOT NULL CONSTRAINT [GRN_varianceFlagged_df] DEFAULT 0,
    CONSTRAINT [GRN_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[GRNLine] (
    [id] NVARCHAR(1000) NOT NULL,
    [grnId] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000) NOT NULL,
    [orderedQty] DECIMAL(10,3),
    [receivedQty] DECIMAL(10,3) NOT NULL,
    [actualPrice] DECIMAL(12,2) NOT NULL,
    [taxRateId] NVARCHAR(1000),
    [taxRate] DECIMAL(5,2) NOT NULL CONSTRAINT [GRNLine_taxRate_df] DEFAULT 0,
    [lineSubtotal] DECIMAL(12,2) NOT NULL,
    [lineTaxAmount] DECIMAL(12,2) NOT NULL,
    [lineTotal] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [GRNLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[GRNLineTaxComponent] (
    [id] NVARCHAR(1000) NOT NULL,
    [grnLineId] NVARCHAR(1000) NOT NULL,
    [componentName] NVARCHAR(1000) NOT NULL,
    [componentRate] DECIMAL(5,2) NOT NULL,
    [componentAmount] DECIMAL(12,2) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [GRNLineTaxComponent_sortOrder_df] DEFAULT 0,
    CONSTRAINT [GRNLineTaxComponent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseOrder_outletId_status_idx] ON [dbo].[PurchaseOrder]([outletId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseOrder_supplierId_idx] ON [dbo].[PurchaseOrder]([supplierId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [POLine_purchaseOrderId_idx] ON [dbo].[POLine]([purchaseOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [POLineTaxComponent_poLineId_idx] ON [dbo].[POLineTaxComponent]([poLineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GRN_outletId_receivedAt_idx] ON [dbo].[GRN]([outletId], [receivedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GRN_supplierId_idx] ON [dbo].[GRN]([supplierId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GRNLine_grnId_idx] ON [dbo].[GRNLine]([grnId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GRNLineTaxComponent_grnLineId_idx] ON [dbo].[GRNLineTaxComponent]([grnLineId]);

-- AddForeignKey
ALTER TABLE [dbo].[POLine] ADD CONSTRAINT [POLine_purchaseOrderId_fkey] FOREIGN KEY ([purchaseOrderId]) REFERENCES [dbo].[PurchaseOrder]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[POLineTaxComponent] ADD CONSTRAINT [POLineTaxComponent_poLineId_fkey] FOREIGN KEY ([poLineId]) REFERENCES [dbo].[POLine]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[GRN] ADD CONSTRAINT [GRN_purchaseOrderId_fkey] FOREIGN KEY ([purchaseOrderId]) REFERENCES [dbo].[PurchaseOrder]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[GRNLine] ADD CONSTRAINT [GRNLine_grnId_fkey] FOREIGN KEY ([grnId]) REFERENCES [dbo].[GRN]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[GRNLineTaxComponent] ADD CONSTRAINT [GRNLineTaxComponent_grnLineId_fkey] FOREIGN KEY ([grnLineId]) REFERENCES [dbo].[GRNLine]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
