BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Currency] (
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [decimalPlaces] INT NOT NULL CONSTRAINT [Currency_decimalPlaces_df] DEFAULT 2,
    CONSTRAINT [Currency_pkey] PRIMARY KEY CLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[ExchangeRate] (
    [id] NVARCHAR(1000) NOT NULL,
    [baseCurrency] NVARCHAR(1000) NOT NULL,
    [targetCurrency] NVARCHAR(1000) NOT NULL,
    [rate] DECIMAL(12,6) NOT NULL,
    [effectiveDate] DATETIME2 NOT NULL CONSTRAINT [ExchangeRate_effectiveDate_df] DEFAULT CURRENT_TIMESTAMP,
    [source] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [ExchangeRate_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExchangeRate_baseCurrency_targetCurrency_effectiveDate_idx] ON [dbo].[ExchangeRate]([baseCurrency], [targetCurrency], [effectiveDate]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
