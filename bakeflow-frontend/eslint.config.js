// Root ESLint flat config — covers `packages/*`, which nothing linted before this file
// existed (TD-010).
//
// Why a second config rather than one at the root for everything: flat config does NOT
// merge across directories. ESLint resolves exactly one config — the nearest one walking
// up from the working directory — so `apps/mobile/eslint.config.js` fully governs the app
// and never composes with this file. Each config therefore owns a disjoint set of paths,
// and `apps/**` is ignored here so the two can never both claim a file and disagree.
//
// `eslint-config-expo/flat` is reused rather than adding `typescript-eslint` directly: it
// already carries the TS parser and plugin, it is already installed and hoisted, and
// `packages/*` is consumed exclusively by the Expo app. Adding a dependency to lint code
// that a present dependency already lints would be churn for no coverage.
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      // Linted by apps/mobile/eslint.config.js under its own working directory.
      'apps/**',
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
    ],
  },
  {
    // jest.config.js is CommonJS (module.exports, __dirname), not the ESM/browser
    // code expoConfig's globals assume — without this override every root-level
    // *.config.js fails lint with "'__dirname' is not defined".
    files: ['*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
