#!/usr/bin/env node
/**
 * Bundles the hook entrypoint into the plugin.
 *
 * The hook process runs under plain `node` (CodeBuddy executes
 * `node "${CODEBUDDY_PLUGIN_ROOT}/hooks/scripts/hook.mjs" <command>`), so every
 * workspace dependency has to be inlined here — the installed plugin cannot
 * resolve this repository's node_modules.
 */
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(packageRoot, "src", "hooks", "cli.ts");
const outDir = join(packageRoot, "plugin", "hooks", "scripts");
const outFile = join(outDir, "hook.mjs");

export async function buildHooks() {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const result = await Bun.build({
		entrypoints: [entry],
		target: "node",
		format: "esm",
		minify: false,
		sourcemap: "none",
		naming: "hook.mjs",
		outdir: outDir,
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error("hook bundle failed");
	}

	const stats = await stat(outFile);
	if (stats.size === 0) throw new Error("hook bundle is empty");
	return { outFile, bytes: stats.size };
}

if (import.meta.main) {
	const { outFile: built, bytes } = await buildHooks();
	console.log(`built ${built} (${bytes} bytes)`);
}
