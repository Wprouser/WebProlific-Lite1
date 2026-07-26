// Injection tokens for repository interfaces — interfaces don't exist at
// runtime, so NestJS needs a token to bind the Prisma implementation to.
export const ITEM_REPOSITORY = Symbol('ITEM_REPOSITORY');
export const CATEGORY_REPOSITORY = Symbol('CATEGORY_REPOSITORY');
export const ITEM_IMAGE_REPOSITORY = Symbol('ITEM_IMAGE_REPOSITORY');
