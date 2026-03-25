import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const memeloopSrcPath = fileURLToPath(new URL("../memeloop/src", import.meta.url));
const protocolSrcPath = fileURLToPath(new URL("../memeloop-protocol/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      memeloop: memeloopSrcPath,
      "@memeloop/protocol": protocolSrcPath,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});
