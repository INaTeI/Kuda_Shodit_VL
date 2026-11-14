/// <reference types="node" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = { target: "http://127.0.0.1:8000", changeOrigin: true };
const proxy = { "/api": backend, "^/sitemap\\.xml(?:\\?|$)": backend };

export default defineConfig({
  plugins: [react()],
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/vdk-app.js",
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith(".css"))
            ? "assets/vdk-app.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  preview: { proxy },
  server: { proxy },
});
