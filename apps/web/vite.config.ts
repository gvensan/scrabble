import { existsSync, readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The Worker's ADMIN_TOKEN, from the shell or apps/worker/.dev.vars. Only the
 * dev server uses it; a production build never embeds it because everything
 * in the bundle is public.
 */
function workerAdminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  const vars = new URL("../worker/.dev.vars", import.meta.url);
  if (!existsSync(vars)) return "";
  const line = readFileSync(vars, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("ADMIN_TOKEN="));
  return line?.slice("ADMIN_TOKEN=".length).trim() ?? "";
}

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    __DEV_ADMIN_TOKEN__: JSON.stringify(
      command === "serve" ? workerAdminToken() : "",
    ),
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
}));
