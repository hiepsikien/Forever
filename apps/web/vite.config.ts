import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@forever/philosophy": fileURLToPath(
        new URL("../../packages/philosophy/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
  },
});
