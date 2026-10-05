// Single-file report bundle: the web app's <Report> as one IIFE + one CSS file in standalone-dist/, inlined by
// GET /r/[id]/report.html into a downloadable HTML document that works offline.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: { alias: { "next/link": here("./src/standalone/shims/link.tsx") } },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.NEXT_PUBLIC_API_URL": "undefined",
    "process.env": "{}", // any other env read in the Report graph is undefined instead of crashing the offline file
  },
  publicDir: false,
  build: {
    outDir: "standalone-dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: here("./src/standalone/main.tsx"), name: "MRAReport", formats: ["iife"], fileName: () => "report.js",
      cssFileName: "report" },
  },
});
