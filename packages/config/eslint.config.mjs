import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared flat config. CLAUDE.md conventions are enforced here, not by review. */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.tsbuildinfo', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // "No `any`, no non-null assertions outside tests."
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Tests and scripts are allowed the ergonomics production code is not.
    files: ['**/*.test.ts', 'scripts/**/*.mts', '**/src/test/**', '**/src/migrate.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
);
