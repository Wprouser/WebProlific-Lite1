/**
 * ESLint 8 "eslintrc" config (not flat config): eslint 8.57 only reads
 * `eslint.config.js` when ESLINT_USE_FLAT_CONFIG=true is set, and requiring
 * an env var to lint is a worse default than using the format this version
 * looks for on its own. Revisit when the project moves to ESLint 9.
 *
 * Scope is the backend only — `npm run lint` globs {src,test}/**\/*.ts. The
 * frontend under web/ has its own linter (oxlint, see web/package.json) and
 * is excluded below so this config never tries to parse it.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    '.eslintrc.js',
    'dist/',
    'node_modules/',
    'coverage/',
    'uploads/',
    // Has its own toolchain (oxlint + tsc -b) and its own tsconfig; the
    // backend tsconfig excludes it, so type-aware parsing would fail here.
    'web/',
    // Generated SQL/artifacts, not hand-written TypeScript.
    'prisma/migrations/',
    'playwright-report/',
    'test-results/',
  ],
  rules: {
    // The codebase deliberately uses interfaces with no members in a few
    // places as nominal markers; more importantly this fires on legitimate
    // DTO/entity shapes and would force churn for no safety gain.
    '@typescript-eslint/no-empty-interface': 'off',

    // Nest's DI and Prisma's generated types make a handful of `any`
    // boundaries unavoidable (e.g. dynamic module factories). Warn so they
    // stay visible without failing the build on pre-existing ones.
    '@typescript-eslint/no-explicit-any': 'warn',

    // `_`-prefixed args are the established convention here for
    // interface-required parameters a given implementation ignores (see
    // ConsoleOtpDispatcherService).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // Tests reach into internals and build partial fixtures; non-null
      // assertions there are deliberate and readable.
      files: ['**/*.spec.ts', 'test/**/*.ts', 'e2e/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
