import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config. Unit tests live next to the pure modules they cover
 * (`*.test.ts`). Cross-package imports (`@supercharts/*`) resolve through the
 * workspace symlinks to each package's built `dist`, so run `pnpm build` first
 * in CI (the test script assumes packages are built).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    // `**/._*` excludes macOS AppleDouble sidecar files the exFAT drive writes next to
    // each source file — they're binary and would fail the parser.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/._*'],
    reporters: 'default',
  },
});
