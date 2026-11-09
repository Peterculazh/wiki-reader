import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  // See vitest.config.ts: Nest DI needs legacy decorators + emitted metadata.
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // See vitest.config.ts
    exclude: [...configDefaults.exclude, 'apps/web/**'],
  },
});
