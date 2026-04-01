import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.tsx",
        "**/*.jsx",
        // Barrel/entry files pull in optional UI deps; behavior is covered via core unit tests.
        "src/**/index.ts",
        // Types-only shim
        "src/native/react-native-shim.d.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
