BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[UnitOfMeasure] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [abbreviation] NVARCHAR(1000) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [UnitOfMeasure_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UnitOfMeasure_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UnitOfMeasure_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UnitOfMeasure_name_outletId_key] UNIQUE NONCLUSTERED ([name],[outletId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UnitOfMeasure_outletId_isActive_idx] ON [dbo].[UnitOfMeasure]([outletId], [isActive]);

-- Seed the full 8-unit starter set for every EXISTING outlet — the same set
-- DefaultUnitsListener seeds for new outlets going forward, so existing
-- outlets aren't left with a permanently smaller starter set than new ones.
INSERT INTO [dbo].[UnitOfMeasure] ([id], [outletId], [name], [abbreviation], [isActive], [createdAt], [updatedAt])
SELECT CONVERT(NVARCHAR(1000), NEWID()), o.[id], u.[name], u.[abbreviation], 1, GETUTCDATE(), GETUTCDATE()
FROM [dbo].[Outlet] o
CROSS JOIN (VALUES
    (N'Kilogram', N'kg'),
    (N'Gram', N'g'),
    (N'Litre', N'L'),
    (N'Millilitre', N'mL'),
    (N'Piece', N'pc'),
    (N'Box', N'box'),
    (N'Dozen', N'dz'),
    (N'Pack', N'pack')
) AS u([name], [abbreviation]);

-- AlterTable: add unitId nullable first so existing Item rows can be
-- backfilled before it's tightened to NOT NULL below.
ALTER TABLE [dbo].[Item] ADD [unitId] NVARCHAR(1000);

-- Backfill: map each existing Item's old `unit` enum value to the matching
-- newly-seeded UnitOfMeasure row in its own outlet.
UPDATE i
SET i.[unitId] = uom.[id]
FROM [dbo].[Item] i
INNER JOIN [dbo].[UnitOfMeasure] uom
    ON uom.[outletId] = i.[outletId]
   AND uom.[abbreviation] = CASE i.[unit]
        WHEN N'KG' THEN N'kg'
        WHEN N'LITRE' THEN N'L'
        WHEN N'PIECE' THEN N'pc'
        WHEN N'BOX' THEN N'box'
        WHEN N'GRAM' THEN N'g'
        WHEN N'ML' THEN N'mL'
    END;

-- AlterTable: tighten unitId to NOT NULL now that every existing row has a
-- value, then drop the old enum-string column.
ALTER TABLE [dbo].[Item] ALTER COLUMN [unitId] NVARCHAR(1000) NOT NULL;
ALTER TABLE [dbo].[Item] DROP COLUMN [unit];

-- CreateIndex
CREATE NONCLUSTERED INDEX [Item_unitId_idx] ON [dbo].[Item]([unitId]);

-- AddForeignKey
ALTER TABLE [dbo].[Item] ADD CONSTRAINT [Item_unitId_fkey] FOREIGN KEY ([unitId]) REFERENCES [dbo].[UnitOfMeasure]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
