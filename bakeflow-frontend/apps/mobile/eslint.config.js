// ESLint 9 flat config. eslint-config-expo@57 ships a flat entry point; the
// legacy `eslint . --ext .ts,.tsx` invocation is not valid under flat config.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'android/*', 'ios/*'],
  },
];
