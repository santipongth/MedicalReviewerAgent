import { readFile } from "node:fs/promises";
import path from "node:path";
import type { StandaloneAssets } from "./standalone-html";

let cached: StandaloneAssets | null = null;

/** The standalone report bundle built by `npm run build:standalone` (shipped next to the server in the image). */
export async function loadStandaloneAssets(): Promise<StandaloneAssets> {
  if (cached) return cached;
  const dir = path.join(process.cwd(), "standalone-dist");
  const [js, css] = await Promise.all([readFile(path.join(dir, "report.js"), "utf8"), readFile(path.join(dir, "report.css"), "utf8")]);
  cached = { js, css };
  return cached;
}
