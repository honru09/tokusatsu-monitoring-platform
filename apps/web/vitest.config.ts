import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest 4 no longer excludes dist. Keep compiled output out of the run.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  },
});
