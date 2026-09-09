import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK_CATALOG } from "../plugin/scripts/migrate-codex-config/catalog.mjs";
import { readCodexModelCatalog } from "../src/install/codex-model-catalog.ts";

// Run with Bun so the check exercises the TypeScript installer source, not its generated bundle.
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(join(packageRoot, "plugin", "model-catalog.json"), "utf8"));
const { current, roles, managedProfiles } = catalog;
assert.deepEqual(
	{ current: FALLBACK_CATALOG.current, roles: FALLBACK_CATALOG.roles, managedProfiles: FALLBACK_CATALOG.managedProfiles },
	{ current, roles, managedProfiles },
	"JSON catalog and migration fallback differ",
);

const missingCatalogRoot = await mkdtemp(join(tmpdir(), "omo-codex-catalog-parity-"));
try {
	const installer = await readCodexModelCatalog(missingCatalogRoot);
	assert.deepEqual(normalize(installer.current), current, "TypeScript current profile differs");
	assert.deepEqual(normalize(installer.managedProfiles), managedProfiles.map((profile) => profile.match), "TypeScript legacy profiles differ");
	// The installer exposes reasoning profiles only; role defaults project its current model/effort.
	const installerCurrent = normalize(installer.current);
	const role = { model: installerCurrent.model, model_reasoning_effort: installerCurrent.model_reasoning_effort };
	assert.deepEqual({ default: installerCurrent, verifier: role, worker: role }, roles, "TypeScript role defaults differ");
} finally {
	await rm(missingCatalogRoot, { recursive: true, force: true });
}
console.log("MATCH");

function normalize(value) {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
			key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
			normalize(entry),
		]));
	}
	return value;
}
