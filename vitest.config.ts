import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@skillhub/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/eval/src/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
  },
});
