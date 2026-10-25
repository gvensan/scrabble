import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The final GitHub Pages project slug will set this at Milestone 4.
  base: "./",
  plugins: [react(), tailwindcss()],
});
