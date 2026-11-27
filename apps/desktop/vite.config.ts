import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri erwartet einen festen Port im Dev-Modus.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  test: { name: "desktop", environment: "jsdom", testTimeout: 30_000, include: ["src/**/*.test.{ts,tsx}"] },
});
