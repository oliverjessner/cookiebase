import js from '@eslint/js';
import globals from 'globals';
export default [{ ignores: ['dist/**', 'node_modules/**', 'artifacts/**', 'test-results/**'] }, js.configs.recommended, { languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } }, rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] } }];
