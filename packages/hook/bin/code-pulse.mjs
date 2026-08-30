#!/usr/bin/env node
// Thin shim that forwards to the compiled CLI. When installed from source
// we fall back to running the TS source via tsx if available.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const compiled = join(root, "dist", "cli.js");

if (existsSync(compiled)) {
  await import(pathToFileURL(compiled).href);
} else {
  const tsxLoader = join(root, "node_modules", "tsx", "dist", "esm", "index.mjs");
  if (existsSync(tsxLoader)) {
    process.env.NODE_OPTIONS = `--import tsx ${process.env.NODE_OPTIONS ?? ""}`.trim();
  }
  await import(pathToFileURL(join(root, "src", "cli.ts")).href);
}
