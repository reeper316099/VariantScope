// ESLint flat config (ESLint 10 no longer uses .eslintrc). Minimal: recommended rules + no-eval family.
import js from '@eslint/js';
import globals from 'globals';

const securityRules = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

export default [
  {
    ignores: [
      'dist/**',
      'release/**',
      'coverage/**',
      'scratch/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  // Renderer code runs in a browser context.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
    rules: securityRules,
  },
  // Electron main process and tooling run in Node (ES modules).
  {
    files: ['electron/**/*.js', 'scripts/**/*.mjs', '*.config.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules: securityRules,
  },
  // The preload script must be CommonJS because it runs sandboxed.
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: globals.node },
    rules: securityRules,
  },
];
