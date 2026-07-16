import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.argv[2] ?? join(packageRoot, "dist");

rmSync(distDir, { recursive: true, force: true });
