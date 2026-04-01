import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Root `pnpm exec vitest run` resolves workspace packages to source (no prebuild required).
 * Package-local vitest.config.ts files still apply per-project test `include` patterns.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@memeloop/protocol": `${root}/packages/memeloop-protocol/src`,
      memeloop: `${root}/packages/memeloop/src`,
    },
  },
});
