/** Interfaces don't exist at runtime, so Nest needs a token to bind the
 * abstract repository to its Prisma implementation — same pattern as every
 * other module here. */
export const ALERT_REPOSITORY = Symbol('ALERT_REPOSITORY');
