BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[MenuItem] (
    [id] NVARCHAR(1000) NOT NULL,
    [outletId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [MenuItem_isActive_df] DEFAULT 0,
    CONSTRAINT [MenuItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MenuItem_outletId_name_key] UNIQUE NONCLUSTERED ([outletId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[Recipe] (
    [id] NVARCHAR(1000) NOT NULL,
    [menuItemId] NVARCHAR(1000) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Recipe_version_df] DEFAULT 1,
    [isCurrent] BIT NOT NULL CONSTRAINT [Recipe_isCurrent_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Recipe_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Recipe_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Recipe_menuItemId_version_key] UNIQUE NONCLUSTERED ([menuItemId],[version])
);

-- CreateTable
CREATE TABLE [dbo].[RecipeLine] (
    [id] NVARCHAR(1000) NOT NULL,
    [recipeId] NVARCHAR(1000) NOT NULL,
    [itemId] NVARCHAR(1000),
    [subRecipeId] NVARCHAR(1000),
    [quantity] DECIMAL(10,4) NOT NULL,
    CONSTRAINT [RecipeLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MenuItem_outletId_isActive_idx] ON [dbo].[MenuItem]([outletId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Recipe_menuItemId_isCurrent_idx] ON [dbo].[Recipe]([menuItemId], [isCurrent]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecipeLine_recipeId_idx] ON [dbo].[RecipeLine]([recipeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecipeLine_itemId_idx] ON [dbo].[RecipeLine]([itemId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecipeLine_subRecipeId_idx] ON [dbo].[RecipeLine]([subRecipeId]);

-- AddForeignKey
ALTER TABLE [dbo].[MenuItem] ADD CONSTRAINT [MenuItem_outletId_fkey] FOREIGN KEY ([outletId]) REFERENCES [dbo].[Outlet]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Recipe] ADD CONSTRAINT [Recipe_menuItemId_fkey] FOREIGN KEY ([menuItemId]) REFERENCES [dbo].[MenuItem]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[RecipeLine] ADD CONSTRAINT [RecipeLine_recipeId_fkey] FOREIGN KEY ([recipeId]) REFERENCES [dbo].[Recipe]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecipeLine] ADD CONSTRAINT [RecipeLine_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[Item]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecipeLine] ADD CONSTRAINT [RecipeLine_subRecipeId_fkey] FOREIGN KEY ([subRecipeId]) REFERENCES [dbo].[Recipe]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

