import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("./", import.meta.url)), "");
  return {
    root: "native",
    base: "./",
    plugins: [react()],
    define: {
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? ""),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
    },
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
  };
});
