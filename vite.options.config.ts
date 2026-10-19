import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { options: "options.html", floating: "floating.html" },
      output: { entryFileNames: "assets/[name].js", assetFileNames: "assets/[name][extname]" }
    }
  }
});
