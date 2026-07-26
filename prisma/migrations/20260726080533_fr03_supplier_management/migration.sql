BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Supplier] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [supplierCode] NVARCHAR(1000),
    [name] NVARCHAR(1000) NOT NULL,
    [contactPerson] NVARCHAR(1000),
    [phone] NVARCHAR(1000),
    [email] NVARCHAR(1000),
    [addressLine] NVARCHAR(1000),
    [city] NVARCHAR(1000),
    [stateOrProvince] NVARCHAR(1000),
    [countryCode] NVARCHAR(1000),
    [postalCode] NVARCHAR(1000),
    [preferredCurrency] NVARCHAR(1000),
    [taxRegistrationType] NVARCHAR(1000),
    [taxRegistrationNumber] NVARCHAR(1000),
    [paymentTerms] NVARCHAR(1000),
    [leadTimeDays] INT,
    [bankAccountName] NVARCHAR(1000),
    [bankAccountNumber] NVARCHAR(1000),
    [bankIfscOrSwift] NVARCHAR(1000),
    [isActive] BIT NOT NULL CONSTRAINT [Supplier_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Supplier_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Supplier_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SupplierPriceHistory] (
    [id] NVARCHAR(1000) NOT NULL,
    [supplierId] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000) NOT NULL,
    [price] DECIMAL(12,2) NOT NULL,
    [currencyCode] NVARCHAR(1000) NOT NULL CONSTRAINT [SupplierPriceHistory_currencyCode_df] DEFAULT 'SAR',
    [recordedAt] DATETIME2 NOT NULL CONSTRAINT [SupplierPriceHistory_recordedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [source] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [SupplierPriceHistory_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Supplier_outletId_isActive_idx] ON [dbo].[Supplier]([outletId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SupplierPriceHistory_supplierId_itemId_recordedAt_idx] ON [dbo].[SupplierPriceHistory]([supplierId], [itemId], [recordedAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
