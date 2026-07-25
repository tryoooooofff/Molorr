import { existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const apiDir = resolve(root, "src/app/api");
const backupDir = resolve(root, "src/__netlify_api_backup");
const nextBin = resolve(root, "node_modules/next/dist/bin/next");
const outDir = resolve(root, "out");

if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

const moved = existsSync(apiDir);
if (moved) renameSync(apiDir, backupDir);

try {
  execFileSync(process.execPath, [nextBin, "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      STATIC_EXPORT: "1",
    },
  });
} finally {
  if (moved && existsSync(backupDir)) {
    renameSync(backupDir, apiDir);
  }
}
