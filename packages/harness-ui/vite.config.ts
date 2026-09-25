import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

const harness = `localhost:${process.env.HARNESS_PORT ?? 5170}`;

export default defineConfig({
  plugins: [wasm()],
  build: { target: "esnext" },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://${harness}`,
      "/sync": { target: `ws://${harness}`, ws: true },
      "/events": { target: `ws://${harness}`, ws: true },
    },
  },
});
