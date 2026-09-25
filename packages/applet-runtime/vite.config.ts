// The protected applet build config (see docs/designs/code-versions.md#applet-code-conventions).
// PoC 1: one bundle containing the loader, @harness/state and the applet in WORK_DIR.

import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

const here = import.meta.dirname;
const workDir = resolve(process.env.WORK_DIR ?? join(here, "../translation-applet"));

export default defineConfig({
  root: here,
  plugins: [wasm(), tailwindcss()],
  resolve: {
    alias: {
      "@applet/main": join(workDir, "main.tsx"),
      "@harness/state": join(here, "src/state.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: "dist", emptyOutDir: true, target: "esnext" },
  server: { port: 5174, strictPort: true },
});
