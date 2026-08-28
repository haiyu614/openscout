import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/ports/**',
        'packages/*/src/index.ts',
        '**/dist/**',
        '**/coverage/**',
        '**/node_modules/**',
      ],
      reporter: ['text-summary', 'text'],
    },
  },
})
