import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The five prelude and doc assets, generated into `assets.generated.json` by
 * `scripts/generate-assets.ts`; field names are the historical generated-constant names.
 */
export type PreludeAssets = {
	readonly COMPUTER_PRELUDE_JAVASCRIPT: string;
	readonly COMPUTER_PRELUDE_PYTHON: string;
	readonly COMPUTER_DECLARATIONS: string;
	readonly COMPUTER_DOCUMENTATION: string;
	readonly COMPUTER_SAFETY: string;
};

const ASSET_FIELDS = [
	"COMPUTER_PRELUDE_JAVASCRIPT",
	"COMPUTER_PRELUDE_PYTHON",
	"COMPUTER_DECLARATIONS",
	"COMPUTER_DOCUMENTATION",
	"COMPUTER_SAFETY",
] as const satisfies readonly (keyof PreludeAssets)[];

// import.meta.dir is Bun-only: the senpi extension bundle loads under plain Node through jiti, where
// it is undefined. jiti rewrites import.meta.url to the real file URL, so the standard ESM idiom
// works on every runtime (same reason as memory-core's persona assets).
const ASSETS_JSON_PATH = join(dirname(fileURLToPath(import.meta.url)), "assets.generated.json");

let cached: PreludeAssets | undefined;

/**
 * Reads the generated asset JSON once per process. The JSON sits beside this module in the source
 * tree and beside the built bundle in the omo plugin (`extensions/assets.generated.json`, staged by
 * `build-extension.mjs`), so the prelude text never enters a file senpi's extension loader
 * re-transpiles at every session start (#9113).
 */
export function preludeAssets(): PreludeAssets {
	if (cached === undefined) {
		const parsed: unknown = JSON.parse(readFileSync(ASSETS_JSON_PATH, "utf8"));
		cached = validateAssets(parsed);
	}
	return cached;
}

function validateAssets(value: unknown): PreludeAssets {
	const record = (value && typeof value === "object" ? value : undefined) as Record<string, unknown> | undefined;
	const missing = ASSET_FIELDS.filter((field) => typeof record?.[field] !== "string");
	if (missing.length > 0) {
		throw new Error(
			`senpi-desktop-prelude asset JSON is malformed at ${ASSETS_JSON_PATH}: missing ${missing.join(", ")}`,
		);
	}
	return value as PreludeAssets;
}
