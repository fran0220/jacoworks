import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "/" : "/static/chat/",
  build: {
    outDir: "../website/static/chat",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "chat.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    port: 5180,
  },
}));
