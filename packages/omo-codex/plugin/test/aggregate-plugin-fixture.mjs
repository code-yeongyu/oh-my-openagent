import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
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

const SPAWN_AGENT_START = /(?:(?<receiver>\b[A-Za-z_]\w*)\s*\.\s*)?(?<callee>\bspawn_agent)\s*\(/g;

async function collectFiles(directory, predicate) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}

	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(path, predicate)));
		else if (entry.isFile() && predicate(path)) files.push(path);
	}
	return files;
}

export async function listShippedSpawnPromptFiles() {
	const skillFiles = [
		...(await collectFiles(join(root, "skills"), (path) => basename(path) === "SKILL.md")),
		...(await collectFiles(
			join(root, "components"),
			(path) => path.includes(`${sep}skills${sep}`) && basename(path) === "SKILL.md",
		)),
	];
	const hephaestusRules = await collectFiles(
		join(root, "components", "rules", "bundled-rules", "hephaestus"),
		(path) => path.endsWith(".md"),
	);
	return [...skillFiles, ...hephaestusRules].sort();
}

export function findSpawnAgentCalls(content) {
	const calls = [];
	for (const match of content.matchAll(SPAWN_AGENT_START)) {
		const openingParenthesis = match.index + match[0].lastIndexOf("(");
		let depth = 1;
		let quote = null;
		let escaped = false;

		for (let index = openingParenthesis + 1; index < content.length; index += 1) {
			const character = content[index];
			if (quote !== null) {
				if (escaped) escaped = false;
				else if (character === "\\") escaped = true;
				else if (character === quote) quote = null;
				continue;
			}
			if (character === '"' || character === "'" || character === "`") {
				quote = character;
				continue;
			}
			if (character === "(") depth += 1;
			else if (character === ")") depth -= 1;
			if (depth !== 0) continue;

			const { receiver = null, callee } = match.groups;
			calls.push({ call: content.slice(match.index, index + 1), index: match.index, receiver, callee });
			break;
		}
	}
	return calls;
}

function tokensForSpawnCall(call) {
	const tokens = [];
	let braceDepth = 0;
	let bracketDepth = 0;
	let parenthesisDepth = 0;

	for (let index = call.indexOf("(") + 1; index < call.length - 1; ) {
		const character = call[index];
		if (/\s/.test(character)) {
			index += 1;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			const start = index;
			const quote = character;
			let value = "";
			index += 1;
			while (index < call.length - 1) {
				const current = call[index];
				if (current === "\\" && index + 1 < call.length - 1) {
					value += call[index + 1];
					index += 2;
					continue;
				}
				index += 1;
				if (current === quote) break;
				value += current;
			}
			tokens.push({ type: "string", value, start, end: index, braceDepth, bracketDepth, parenthesisDepth });
			continue;
		}
		if (/[A-Za-z_]/.test(character)) {
			const start = index;
			while (/[A-Za-z0-9_]/.test(call[index] ?? "")) index += 1;
			tokens.push({ type: "identifier", value: call.slice(start, index), start, end: index,
				braceDepth, bracketDepth, parenthesisDepth });
			continue;
		}

		if (character === "{") braceDepth += 1;
		else if (character === "}") braceDepth -= 1;
		else if (character === "[") bracketDepth += 1;
		else if (character === "]") bracketDepth -= 1;
		else if (character === "(") parenthesisDepth += 1;
		else if (character === ")") parenthesisDepth -= 1;
		else if (character === ":" || character === "=") {
			tokens.push({ type: "separator", value: character, start: index, end: index + 1,
				braceDepth, bracketDepth, parenthesisDepth });
		}
		index += 1;
	}
	return tokens;
}

function spawnParameters(call) {
	const tokens = tokensForSpawnCall(call);
	const parameters = [];
	for (let index = 0; index < tokens.length - 2; index += 1) {
		const key = tokens[index];
		const separator = tokens[index + 1];
		const value = tokens[index + 2];
		const isArgumentScope = key.parenthesisDepth === 0 && key.bracketDepth === 0 && key.braceDepth <= 1;
		const isSameScope =
			separator.braceDepth === key.braceDepth && separator.bracketDepth === key.bracketDepth &&
			separator.parenthesisDepth === key.parenthesisDepth && value.braceDepth === key.braceDepth &&
			value.bracketDepth === key.bracketDepth &&
			value.parenthesisDepth === key.parenthesisDepth;
		const isAdjacent = /^\s*$/.test(call.slice(key.end, separator.start)) &&
			/^\s*$/.test(call.slice(separator.end, value.start));
		if (!isArgumentScope || !isSameScope || !isAdjacent || separator.type !== "separator") continue;
		parameters.push({ name: key.value, value, direct: key.braceDepth === 0 });
	}
	return parameters;
}

export function hasSpawnIsolationArgument(call) {
	return spawnParameters(call).some(
		({ name, value }) => (name === "fork_context" && value.type === "identifier" && value.value === "false") ||
			(name === "fork_turns" && value.type === "string" && value.value === "none"),
	);
}

export function findSpawnAgentCallsWithoutIsolation(content) {
	return findSpawnAgentCalls(content).filter(({ call }) => !hasSpawnIsolationArgument(call));
}

export function findSpawnAgentCallsWithUnsupportedParameters(content) {
	return findSpawnAgentCalls(content).flatMap((entry) => {
		const allowsObjectAgentType = entry.receiver === "multi_agent_v1";
		const parameters = spawnParameters(entry.call)
			.filter(({ name, direct }) => name === "model" || name === "reasoning_effort" ||
				(name === "agent_type" && (direct || !allowsObjectAgentType)))
			.map(({ name }) => name);
		return parameters.length === 0 ? [] : [{ ...entry, parameters }];
	});
}

async function findShippedSpawnViolations(findViolations) {
	const violations = [];
	for (const path of await listShippedSpawnPromptFiles()) {
		const content = await readFile(path, "utf8");
		for (const violation of findViolations(content)) {
			const line = content.slice(0, violation.index).split("\n").length;
			violations.push({ path, line, ...violation });
		}
	}
	return violations;
}

export const findShippedSpawnIsolationViolations = () => findShippedSpawnViolations(findSpawnAgentCallsWithoutIsolation);
export const findShippedUnsupportedSpawnParameterViolations = () =>
	findShippedSpawnViolations(findSpawnAgentCallsWithUnsupportedParameters);
