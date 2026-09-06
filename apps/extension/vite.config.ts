import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/extension",
  base: "./",
  build: { outDir: "build", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
