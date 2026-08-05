/** Interfaces don't exist at runtime, so Nest needs a token to bind the
 * abstract repository to its Prisma implementation — same pattern as every
 * other module here. */
export const SALE_REPOSITORY = Symbol('SALE_REPOSITORY');
export const SALE_IMPORT_REPOSITORY = Symbol('SALE_IMPORT_REPOSITORY');
