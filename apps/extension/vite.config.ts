import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  root: "apps/extension",
  base: "./",
  build: {
    outDir: "build",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: resolve("apps/extension/index.html"),
        background: resolve("apps/extension/src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
  server: { host: "127.0.0.1" },
});
