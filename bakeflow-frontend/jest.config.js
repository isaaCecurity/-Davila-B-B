/**
 * P11.3 — frontend unit-test infrastructure, the first runner this repo has had.
 *
 * `preset: 'jest-expo'` rather than a lighter plain-TypeScript transform: it is the one
 * config that can eventually run both the RN-free logic in `packages/*` (validation,
 * decimal/scalar handling, error normalization — most of what has unit-test value today)
 * and, later, actual React Native components, without maintaining two separate jest
 * configs. `packages/auth/claims.ts`'s own header explains why the RN-free split matters:
 * anything importing `react-native` (even transitively) cannot be transformed by a plain
 * esbuild/tsx script, which is why `scripts/verify-cache-isolation.mts` existed as a
 * workaround before this config did. Jest with `jest-expo` handles both.
 *
 * `roots` covers the whole workspace (`apps/mobile` and `packages/*`) from a single
 * command at the repo root, matching how `typecheck`/`lint` already run.
 */
module.exports = {
  preset: 'jest-expo',
  rootDir: __dirname,
  roots: ['<rootDir>/apps/mobile', '<rootDir>/packages'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/', '/dist/'],
};
