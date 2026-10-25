import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Build output contains compiled copies of the test files.
    exclude: [...configDefaults.exclude, "**/dist/**", "**/.wrangler/**"],
  },
});
