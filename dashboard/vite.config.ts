import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://localhost:3016" },
    // brand.json lives at the repo root, one level up.
    fs: { allow: [".."] },
  },
  build: { target: "es2020", sourcemap: false },
});
