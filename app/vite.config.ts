import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 3000,
  },
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
  },
});
