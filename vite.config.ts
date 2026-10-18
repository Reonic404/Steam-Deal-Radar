import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.join(__dirname, "src/renderer"),
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.join(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
