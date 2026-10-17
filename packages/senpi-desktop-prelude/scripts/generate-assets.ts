// Precompiles the prelude and doc assets into src/assets.generated.json, which src/assets.ts reads
// lazily, so the ~29 KB of prelude text never enters a bundle that senpi's extension loader
// re-transpiles at every session start (#9113). Runs first in `build`; `test/assets.test.ts` fails
// when the committed JSON drifts from the assets.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** JSON field name -> asset path relative to the package root. */
const ASSETS: Readonly<Record<string, string>> = {
	COMPUTER_PRELUDE_JAVASCRIPT: "src/prelude.js",
	COMPUTER_PRELUDE_PYTHON: "src/prelude.py",
	COMPUTER_DECLARATIONS: "declarations.d.ts",
	COMPUTER_DOCUMENTATION: "docs/computer.md",
	COMPUTER_SAFETY: "docs/computer-safety.md",
};

export const ASSETS_JSON_PATH = join(packageDir, "src", "assets.generated.json");

export function renderAssetsJson(): string {
	const entries = Object.entries(ASSETS).map(([name, path]) => {
		return [name, readFileSync(join(packageDir, path), "utf8")] as const;
	});
	return `${JSON.stringify(Object.fromEntries(entries), null, "\t")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(ASSETS_JSON_PATH, renderAssetsJson());
}
