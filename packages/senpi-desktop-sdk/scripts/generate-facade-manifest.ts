// Regenerates facade-manifest.json from src/facade.ts.
// Run: bun run --cwd packages/senpi-desktop-sdk generate
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderFacadeManifest } from "./facade-manifest";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(
	join(packageDir, "facade-manifest.json"),
	renderFacadeManifest(readFileSync(join(packageDir, "src/facade.ts"), "utf8")),
);
