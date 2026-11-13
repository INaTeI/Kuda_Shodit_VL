/// <reference types="node" />
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));

// Публикует автономный прототип конструктора места как /constructor/.
// В Docker-сборке (context ./frontend) папки design/ нет — тогда шаг пропускается.
function constructorPrototype(): Plugin {
  const source = resolve(here, "../design/place-constructor/index.html");
  return {
    name: "constructor-prototype",
    apply: "build",
    closeBundle() {
      if (!existsSync(source)) {
        this.warn("design/place-constructor/index.html не найден — /constructor/ не собран");
        return;
      }
      const target = resolve(here, "dist/constructor/index.html");
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    },
  };
}

export default defineConfig({
  plugins: [react(), constructorPrototype()],
  preview: { proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } } },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
