import { copyFileSync, existsSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { log } from "./logger";
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "./plugin-identity";

function buildCanonicalPath(legacyPath: string): string {
	const dir = dirname(legacyPath);
	const ext = basename(legacyPath).includes(".jsonc") ? ".jsonc" : ".json";
	return join(dir, `${CONFIG_BASENAME}${ext}`);
}

function hasAnyCanonicalPath(dir: string): boolean {
	return (
		existsSync(join(dir, `${CONFIG_BASENAME}.jsonc`)) ||
		existsSync(join(dir, `${CONFIG_BASENAME}.json`))
	);
}

export function migrateLegacyConfigFile(legacyPath: string): boolean {
	if (!existsSync(legacyPath)) return false;
	if (!basename(legacyPath).startsWith(LEGACY_CONFIG_BASENAME)) return false;

	const dir = dirname(legacyPath);
	if (hasAnyCanonicalPath(dir)) return false;

	const canonicalPath = buildCanonicalPath(legacyPath);

	try {
		copyFileSync(legacyPath, canonicalPath);
		log("[migrateLegacyConfigFile] Copied legacy config to canonical path", {
			from: legacyPath,
			to: canonicalPath,
		});
		return true;
	} catch (error) {
		log("[migrateLegacyConfigFile] Failed to copy legacy config file", {
			legacyPath,
			error,
		});
		return false;
	}
}
