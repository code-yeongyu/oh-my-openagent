import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function readDistributionManifest(repoRoot) {
	try {
		const parsed = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
		if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) return undefined;
		return {
			name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : "lazycodex-ai",
			version: parsed.version.trim(),
		};
	} catch (error) {
		if (error instanceof Error) return undefined;
		throw error;
	}
}

export function resolveLazyCodexPluginVersion({ manifestVersion, marketplaceName, pluginName, distributionManifest }) {
	if (marketplaceName === "sisyphuslabs" && pluginName === "omo" && distributionManifest !== undefined) {
		return distributionManifest.version;
	}
	return manifestVersion ?? "local";
}

export async function stampLazyCodexPluginVersion({ pluginRoot, version }) {
	await stampJsonVersion(join(pluginRoot, ".codex-plugin", "plugin.json"), version);
	await stampJsonVersion(join(pluginRoot, "package.json"), version);
	await stampHookStatusMessages(join(pluginRoot, "hooks", "hooks.json"), version);
}

export async function writeLazyCodexInstallSnapshot({ pluginRoot, distributionManifest }) {
	if (distributionManifest === undefined) return;
	await writeFile(
		join(pluginRoot, "lazycodex-install.json"),
		`${JSON.stringify(
			{
				packageName: distributionManifest.name,
				version: distributionManifest.version,
			},
			null,
			"\t",
		)}\n`,
	);
}

async function stampJsonVersion(path, version) {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
		parsed.version = version;
		await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`);
	} catch (error) {
		if (error instanceof Error) return;
		throw error;
	}
}

async function stampHookStatusMessages(path, version) {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
		stampHookGroups(parsed.hooks, version);
		await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`);
	} catch (error) {
		if (error instanceof Error) return;
		throw error;
	}
}

function stampHookGroups(hooks, version) {
	if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) return;
	for (const groups of Object.values(hooks)) {
		if (!Array.isArray(groups)) continue;
		for (const group of groups) {
			if (typeof group !== "object" || group === null || !Array.isArray(group.hooks)) continue;
			for (const hook of group.hooks) {
				stampHookStatusMessage(hook, version);
			}
		}
	}
}

function stampHookStatusMessage(hook, version) {
	if (typeof hook !== "object" || hook === null || typeof hook.statusMessage !== "string") return;
	hook.statusMessage = hook.statusMessage.replace(/^LazyCodex\([^)]+\):/, `LazyCodex(${version}):`);
}
