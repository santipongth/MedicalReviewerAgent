import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // A hang guard, not a timing assertion: the heaviest report renders take ~1 s alone and passed 5 s when three suites
    // shared the CPU (Task 9 stress runs). No test waits on wall-clock time (fake timers or real events instead).
    testTimeout: 20_000,
  },
});
