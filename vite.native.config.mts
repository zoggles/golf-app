import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "native",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./", import.meta.url)) },
      { find: "next/link", replacement: fileURLToPath(new URL("./native/shims/next-link.tsx", import.meta.url)) },
      {
        find: "next/navigation",
        replacement: fileURLToPath(new URL("./native/shims/next-navigation.ts", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "../dist-native",
    emptyOutDir: true,
  },
});
