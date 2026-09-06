import { defineConfig } from "vite";
import { resolve } from "node:path";

// MV3 content scripts are classic scripts: no imports or web-accessible modules.
export default defineConfig({
  build: {
    outDir: "apps/extension/build",
    emptyOutDir: false,
    lib: {
      entry: resolve("apps/extension/src/coursebin/content.ts"),
      name: "USCCoursebin",
      formats: ["iife"],
      fileName: () => "coursebin.js",
    },
    sourcemap: false,
  },
});
