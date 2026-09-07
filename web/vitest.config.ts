import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    unstubEnvs: true,     // auto-restore process.env stubs after each test
    restoreMocks: true,   // auto-restore vi.fn() spies after each test
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/__tests__/**", "lib/**/*.d.ts"],
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@runback/schema": path.resolve(__dirname, "../packages/schema/src/index.ts"),
    },
  },
});
