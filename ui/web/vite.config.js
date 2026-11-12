import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// `npm run dev` serves the editor with hot reload on :5173 and sends API, image and font requests to the
// Python server (./mangapipe-ui, :8765). `npm run build` writes dist/, which that server serves itself.
const api = process.env.MANGAMAKER_API || "http://127.0.0.1:8765";
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true, target: "es2022" },
  server: { port: 5173, proxy: { "/api": api, "/img": api, "/font": api } },
});
