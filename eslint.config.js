import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.playwright/**',
      '.tanstack/**',
      '.vite/**',
      '.vercel/**',
      'dist/**',
      'node_modules/**',
      'src/routeTree.gen.ts',
    ],
  },
  {
    ...eslint.configs.recommended,
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server/**/*.{ts,mjs}', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
