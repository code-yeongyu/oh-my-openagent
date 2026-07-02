import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = join(root, "..", "..", "..");

export async function readJson(relativePath) {
	return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

export async function readRepoJson(relativePath) {
	return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

export async function readPluginVersion() {
	return (await readJson(".codex-plugin/plugin.json")).version;
}

export async function readAggregateHookManifests() {
	const manifest = await readJson(".codex-plugin/plugin.json");
	const hookPaths = Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
	return Promise.all(
		hookPaths
			.filter((hookPath) => typeof hookPath === "string")
			.map(async (hookPath) => {
				const source = hookPath.replace(/^\.\//, "");
				return { source, hooks: await readJson(source) };
			}),
	);
}

export async function exists(relativePath) {
	try {
		await stat(join(root, relativePath));
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

export async function readComponentHookManifests() {
	const components = await readdir(join(root, "components"), { withFileTypes: true });
	const manifests = [];
	for (const entry of components) {
		if (!entry.isDirectory()) continue;
		const source = join("components", entry.name, "hooks", "hooks.json");
		if (!(await exists(source))) continue;
		manifests.push({ source, hooks: await readJson(source) });
	}
	return manifests.sort((left, right) => left.source.localeCompare(right.source));
}

export function collectCommandHooks(hooks, source) {
	const config = hooks.hooks;
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new TypeError(`Invalid hooks manifest: ${source}`);
	}
	const commandHooks = [];
	for (const [eventName, groups] of Object.entries(config)) {
		if (!Array.isArray(groups)) {
			throw new TypeError(`Invalid hook groups in ${source}:${eventName}`);
		}
		groups.forEach((group, groupIndex) => {
			if (typeof group !== "object" || group === null || !Array.isArray(group.hooks)) {
				throw new TypeError(`Invalid hook group in ${source}:${eventName}:${groupIndex}`);
			}
			group.hooks.forEach((handler, handlerIndex) => {
				if (typeof handler !== "object" || handler === null || handler.type !== "command") return;
				commandHooks.push({ source, eventName, groupIndex, handlerIndex, matcher: group.matcher, handler });
			});
		});
	}
	return commandHooks;
}

export function hookLocation({ source, eventName, groupIndex, handlerIndex, handler }) {
	return `${source}:${eventName}:${groupIndex}:${handlerIndex}:${handler.command}`;
}

export function findInvalidSpawnAgentRoleParameters(content) {
	return [...content.matchAll(/spawn_agent\([^)\n]*(?:agent_type|model|reasoning_effort)\s*=/g)].map((match) => match[0]);
}

export function findSpawnAgentCallsWithoutForkContextFalse(content) {
	const missingForkContext = [];
	const regex = /spawn_agent\(([^)]*)\)/g;
	for (const match of content.matchAll(regex)) {
		const call = match[0];
		if (!/"fork_context"\s*:\s*false|fork_context:\s*false|fork_context=false/.test(call)) {
			missingForkContext.push(call);
		}
	}
	return missingForkContext;
}
