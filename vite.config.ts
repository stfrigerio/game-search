import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.PORT ?? "3001";

// The public URL, for the canonical link and the share card in index.html.
const site = (process.env.SITE_URL || "https://gamesearch.manong.app").replace(/\/$/, "");

export default defineConfig({
  plugins: [react(), { name: "site-url", transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", site) }],
  build: { outDir: "dist" },
  server: {
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
});
