import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.PORT ?? "3001";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
});
