#!/usr/bin/env node
// Vendors omo-codex plugin components into the omo-claude (Claude Code) plugin.
//
// For each handled component this script copies the component's runtime-source
// surface (src/, package.json, tsconfig.json, tsconfig.build.json,
// hooks/hooks.json, skills/) from packages/omo-codex/plugin/components/<c>/ into
// packages/omo-claude/plugin/components/<c>/, then applies a DECLARATIVE PATCH
// MANIFEST of string replacements to turn the Codex component into the vendored
// Claude Code component.
//
// Modes:
//   node sync-components.mjs [componentName]   sync one component (or all)
//   node sync-components.mjs --check           re-derive the patched output and
//                                              compare against the dest on disk;
//                                              exit nonzero with a diff summary if
//                                              they differ (detects hand-drift).
//
// Path resolution mirrors sync-skills.mjs / sync-telemetry-component.mjs: all
// roots are derived from import.meta.url so the script is location-stable.
//
// The telemetry component is intentionally EXCLUDED here (it is owned by a
// different track and synced by scripts/sync-telemetry-component.mjs).

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLAUDE_PLUGIN_ROOT = dirname(SCRIPT_DIR);
const CLAUDE_PACKAGE_ROOT = dirname(CLAUDE_PLUGIN_ROOT);
const PACKAGES_ROOT = dirname(CLAUDE_PACKAGE_ROOT);

export const SOURCE_COMPONENTS_ROOT = join(PACKAGES_ROOT, "omo-codex", "plugin", "components");
export const DEST_COMPONENTS_ROOT = join(CLAUDE_PLUGIN_ROOT, "components");

// Components handled by this script (telemetry is EXCLUDED — different track).
export const HANDLED_COMPONENTS = [
	"rules",
	"comment-checker",
	"lsp",
	"ultrawork",
	"ultragoal",
	"start-work-continuation",
];

// Per-component copy surface. Directories are copied recursively; files are
// copied verbatim. Entries that do not exist in the source are skipped.
const COPY_DIRS = ["src", "skills"];

// Components that additionally ship a build-time `scripts/` dir whose contents
// must be vendored (so their `prebuild`/`build` lifecycle resolves in the CC
// plugin tree). Keyed per-component so unrelated components — e.g. `rules`,
// which ships an internal bench script that is NOT needed at install time — do
// not silently pull a `scripts/` dir into the vendored tree.
const COPY_DIRS_BY_COMPONENT = {
	lsp: ["scripts"],
	rules: ["bundled-rules"],
};
// `directive.md` is read at runtime by ultrawork/start-work-continuation via
// `new URL("../directive.md", import.meta.url)` (component root, sibling of dist/);
// copied only for components that actually ship one.
const COPY_FILES = ["package.json", "tsconfig.json", "tsconfig.build.json", "directive.md", join("hooks", "hooks.json")];

// Shared hooks.json env-var transform applied to EVERY handled component that
// ships a hooks/hooks.json. Only replaces tokens that are actually present.
const HOOKS_ENV_REPLACEMENTS = [
	{ find: "${PLUGIN_ROOT}", replace: "${CLAUDE_PLUGIN_ROOT}" },
	{ find: "${PLUGIN_DATA}", replace: "${CLAUDE_PLUGIN_DATA}" },
];

// ---------------------------------------------------------------------------
// DECLARATIVE PATCH MANIFEST
//
// Each entry: { component, file, replacements: [{ find, replace, required? }] }
//   - `file` is relative to the component dest root.
//   - `find` is an exact substring (replaceAll); a `required:true` replacement
//     whose `find` does not occur in the source throws.
//   - hooks/hooks.json env-var transforms are injected automatically for all
//     handled components (see buildHooksJsonReplacements) and need NOT be listed
//     here.
// ---------------------------------------------------------------------------
export const PATCH_MANIFEST = [
	// ----- rules -----------------------------------------------------------
	{
		component: "rules",
		file: "src/cli.ts",
		replacements: [
			// PLUGIN_DATA env fallback (cli.ts reads it for the cache root).
			{
				find: 'const pluginDataRoot = process.env["PLUGIN_DATA"];',
				replace:
					'const pluginDataRoot = process.env["CLAUDE_PLUGIN_DATA"] ?? process.env["PLUGIN_DATA"];',
				required: true,
			},
			// UserPromptSubmit: drop turn_id requirement, make model optional.
			{
				find:
					'\t\tvalue["hook_event_name"] === "UserPromptSubmit" &&\n' +
					'\t\ttypeof value["session_id"] === "string" &&\n' +
					'\t\ttypeof value["turn_id"] === "string" &&\n' +
					'\t\tisStringOrNull(value["transcript_path"]) &&\n' +
					'\t\ttypeof value["cwd"] === "string" &&\n' +
					'\t\ttypeof value["model"] === "string" &&\n' +
					'\t\ttypeof value["permission_mode"] === "string" &&\n' +
					'\t\ttypeof value["prompt"] === "string"',
				replace:
					'\t\tvalue["hook_event_name"] === "UserPromptSubmit" &&\n' +
					'\t\ttypeof value["session_id"] === "string" &&\n' +
					'\t\t(typeof value["turn_id"] === "string" || value["turn_id"] === undefined) &&\n' +
					'\t\tisStringOrNull(value["transcript_path"]) &&\n' +
					'\t\ttypeof value["cwd"] === "string" &&\n' +
					'\t\t(typeof value["model"] === "string" || value["model"] === undefined) &&\n' +
					'\t\ttypeof value["permission_mode"] === "string" &&\n' +
					'\t\ttypeof value["prompt"] === "string"',
				required: true,
			},
			// PostToolUse: drop turn_id requirement, make model optional.
			{
				find:
					'\t\tvalue["hook_event_name"] === "PostToolUse" &&\n' +
					'\t\ttypeof value["session_id"] === "string" &&\n' +
					'\t\ttypeof value["turn_id"] === "string" &&\n' +
					'\t\tisStringOrNull(value["transcript_path"]) &&\n' +
					'\t\ttypeof value["cwd"] === "string" &&\n' +
					'\t\ttypeof value["model"] === "string" &&\n' +
					'\t\ttypeof value["permission_mode"] === "string" &&\n' +
					'\t\ttypeof value["tool_name"] === "string" &&\n' +
					'\t\ttypeof value["tool_use_id"] === "string"',
				replace:
					'\t\tvalue["hook_event_name"] === "PostToolUse" &&\n' +
					'\t\ttypeof value["session_id"] === "string" &&\n' +
					'\t\t(typeof value["turn_id"] === "string" || value["turn_id"] === undefined) &&\n' +
					'\t\tisStringOrNull(value["transcript_path"]) &&\n' +
					'\t\ttypeof value["cwd"] === "string" &&\n' +
					'\t\t(typeof value["model"] === "string" || value["model"] === undefined) &&\n' +
					'\t\ttypeof value["permission_mode"] === "string" &&\n' +
					'\t\ttypeof value["tool_name"] === "string" &&\n' +
					'\t\ttypeof value["tool_use_id"] === "string"',
				required: true,
			},
			// PostCompact: drop turn_id requirement, make model optional.
			{
				find:
					'\t\tvalue["hook_event_name"] === "PostCompact" &&\n' +
					'\t\ttypeof value["session_id"] === "string" &&\n' +
					'\t\ttypeof value["turn_id"] === "string" &&\n' +
					'\t\tisStringOrNull(value["transcript_path"]) &&\n' +
					'\t\ttypeof value["cwd"] === "string" &&\n' +
					'\t\ttypeof value["model"] === "string" &&\n' +
					'\t\t(value["trigger"] === "manual" || value["trigger"] === "auto")',
				replace:
					'\t\tvalue["hook_event_name"] === "PostCompact" &&\n' +
					'\t\ttypeof value["session_id"] === "string" &&\n' +
					'\t\t(typeof value["turn_id"] === "string" || value["turn_id"] === undefined) &&\n' +
					'\t\tisStringOrNull(value["transcript_path"]) &&\n' +
					'\t\ttypeof value["cwd"] === "string" &&\n' +
					'\t\t(typeof value["model"] === "string" || value["model"] === undefined) &&\n' +
					'\t\t(value["trigger"] === "manual" || value["trigger"] === "auto")',
				required: true,
			},
		],
	},
	{
		component: "rules",
		file: "src/rules/plugin-root.ts",
		replacements: [
			{
				find: 'const PLUGIN_MANIFEST_PATH = join(".codex-plugin", "plugin.json");',
				replace: 'const PLUGIN_MANIFEST_PATH = join(".claude-plugin", "plugin.json");',
				required: true,
			},
			{
				find: 'const configuredRoot = pluginRoot ?? process.env["PLUGIN_ROOT"];',
				replace:
					'const configuredRoot = pluginRoot ?? process.env["CLAUDE_PLUGIN_ROOT"] ?? process.env["PLUGIN_ROOT"];',
				required: true,
			},
		],
	},
	{
		component: "rules",
		file: "src/persistent-cache.ts",
		replacements: [
			{
				find:
					'const root = pluginDataRoot ?? process.env["PLUGIN_DATA"] ?? join(homedir(), ".codex", "codex-rules");',
				replace:
					'const root = pluginDataRoot ?? process.env["CLAUDE_PLUGIN_DATA"] ?? process.env["PLUGIN_DATA"] ?? join(homedir(), ".claude", "omo-claude-rules");',
				required: true,
			},
		],
	},
	{
		component: "rules",
		file: "src/config.ts",
		// Add an OMO_CLAUDE_RULES_* alias as the highest-priority lookup in each
		// firstEnv() call, keeping the existing CODEX_RULES_* / PI_RULES_* aliases.
		replacements: [
			{
				find: 'firstEnv(env, "CODEX_RULES_DISABLE_BUNDLED", "PI_RULES_DISABLE_BUNDLED")',
				replace:
					'firstEnv(env, "OMO_CLAUDE_RULES_DISABLE_BUNDLED", "CODEX_RULES_DISABLE_BUNDLED", "PI_RULES_DISABLE_BUNDLED")',
				required: true,
			},
			{
				find: 'firstEnv(env, "CODEX_RULES_DISABLED", "PI_RULES_DISABLED")',
				replace:
					'firstEnv(env, "OMO_CLAUDE_RULES_DISABLED", "CODEX_RULES_DISABLED", "PI_RULES_DISABLED")',
				required: true,
			},
			{
				find: 'firstEnv(env, "CODEX_RULES_MODE", "PI_RULES_MODE")',
				replace: 'firstEnv(env, "OMO_CLAUDE_RULES_MODE", "CODEX_RULES_MODE", "PI_RULES_MODE")',
				required: true,
			},
			{
				find: 'firstEnv(env, "CODEX_RULES_MAX_RULE_CHARS", "PI_RULES_MAX_RULE_CHARS")',
				replace:
					'firstEnv(env, "OMO_CLAUDE_RULES_MAX_RULE_CHARS", "CODEX_RULES_MAX_RULE_CHARS", "PI_RULES_MAX_RULE_CHARS")',
				required: true,
			},
			{
				find: 'firstEnv(env, "CODEX_RULES_MAX_RESULT_CHARS", "PI_RULES_MAX_RESULT_CHARS")',
				replace:
					'firstEnv(env, "OMO_CLAUDE_RULES_MAX_RESULT_CHARS", "CODEX_RULES_MAX_RESULT_CHARS", "PI_RULES_MAX_RESULT_CHARS")',
				required: true,
			},
			{
				find:
					'firstEnv(env, "CODEX_RULES_POST_COMPACT_MAX_RULE_CHARS", "PI_RULES_POST_COMPACT_MAX_RULE_CHARS")',
				replace:
					'firstEnv(env, "OMO_CLAUDE_RULES_POST_COMPACT_MAX_RULE_CHARS", "CODEX_RULES_POST_COMPACT_MAX_RULE_CHARS", "PI_RULES_POST_COMPACT_MAX_RULE_CHARS")',
				required: true,
			},
			{
				find:
					'firstEnv(env, "CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS", "PI_RULES_POST_COMPACT_MAX_RESULT_CHARS")',
				replace:
					'firstEnv(env, "OMO_CLAUDE_RULES_POST_COMPACT_MAX_RESULT_CHARS", "CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS", "PI_RULES_POST_COMPACT_MAX_RESULT_CHARS")',
				required: true,
			},
			{
				find: 'firstEnv(env, "CODEX_RULES_ENABLED_SOURCES", "PI_RULES_ENABLED_SOURCES")',
				replace:
					'firstEnv(env, "OMO_CLAUDE_RULES_ENABLED_SOURCES", "CODEX_RULES_ENABLED_SOURCES", "PI_RULES_ENABLED_SOURCES")',
				required: true,
			},
		],
	},
	{
		component: "rules",
		file: "hooks/hooks.json",
		// Widen the PostToolUse matcher so CC native edit tools fire the hook.
		replacements: [
			{
				find: '"matcher": "^apply_patch$",',
				replace: '"matcher": "^(apply_patch|Write|Edit|MultiEdit)$",',
				required: true,
			},
		],
	},

	// ----- comment-checker -------------------------------------------------
	{
		component: "comment-checker",
		file: "src/codex-hook.ts",
		replacements: [
			// Make the type fields model?/turn_id? optional.
			{
				find: "\tsession_id: string;\n\tturn_id: string;\n",
				replace: "\tsession_id: string;\n\tturn_id?: string;\n",
				required: true,
			},
			{
				find: '\thook_event_name: "PostToolUse";\n\tmodel: string;\n',
				replace: '\thook_event_name: "PostToolUse";\n\tmodel?: string;\n',
				required: true,
			},
			// Weaken the runtime validator (keep permission_mode required).
			{
				find: '\t\ttypeof value["turn_id"] === "string" &&',
				replace:
					'\t\t(typeof value["turn_id"] === "string" || value["turn_id"] === undefined) &&',
				required: true,
			},
			{
				find: '\t\ttypeof value["model"] === "string" &&',
				replace: '\t\t(typeof value["model"] === "string" || value["model"] === undefined) &&',
				required: true,
			},
		],
	},

	// ----- lsp -------------------------------------------------------------
	// hooks.json env-var transform only (handled automatically).

	// ----- ultrawork -------------------------------------------------------
	// hooks.json env-var transform only (handled automatically).

	// ----- ultragoal -------------------------------------------------------
	// COPY VERBATIM — no patch entries (its deep refactor is a separate task).
	// The hooks.json env-var transform still applies (handled automatically).

	// ----- start-work-continuation ----------------------------------------
	{
		component: "start-work-continuation",
		file: "src/boulder-reader.ts",
		replacements: [
			{
				find: "const work = findMatchingWork(parsed, `codex:${sessionId}`);",
				replace: "const work = findMatchingWork(parsed, `claude:${sessionId}`);",
				required: true,
			},
		],
	},
	{
		component: "start-work-continuation",
		file: "src/codex-hook.ts",
		// Make model/turn_id optional in the Stop/SubagentStop validator (keep
		// permission_mode required).
		replacements: [
			{
				find: '\t\ttypeof value["turn_id"] === "string" &&',
				replace:
					'\t\t(typeof value["turn_id"] === "string" || value["turn_id"] === undefined) &&',
				required: true,
			},
			{
				find: '\t\ttypeof value["model"] === "string" &&',
				replace: '\t\t(typeof value["model"] === "string" || value["model"] === undefined) &&',
				required: true,
			},
		],
	},
];

// ---------------------------------------------------------------------------
// Core: derive the expected vendored tree (in memory), then either write it or
// compare it against what is currently on disk.
// ---------------------------------------------------------------------------

class PatchError extends Error {}

function buildPatchIndex(components) {
	const index = new Map();
	for (const component of components) {
		index.set(component, new Map());
	}
	for (const entry of PATCH_MANIFEST) {
		if (!index.has(entry.component)) continue;
		index.get(entry.component).set(normalizeRel(entry.file), entry.replacements);
	}
	// Inject the shared hooks.json env-var transform for every handled component.
	for (const component of components) {
		const hooksRel = normalizeRel(join("hooks", "hooks.json"));
		const existing = index.get(component).get(hooksRel) ?? [];
		index.get(component).set(hooksRel, [
			...HOOKS_ENV_REPLACEMENTS.map((replacement) => ({ ...replacement, required: false })),
			...existing,
		]);
	}
	return index;
}

function normalizeRel(relPath) {
	return relPath.split(/[\\/]/).join("/");
}

function applyReplacements(component, relPath, text, replacements, matched) {
	let result = text;
	for (const { find, replace, required } of replacements) {
		const hit = result.includes(find);
		matched.push({ component, file: relPath, find, replace, matched: hit, required: Boolean(required) });
		if (!hit) {
			if (required) {
				throw new PatchError(
					`required replacement did not match in ${component}/${relPath}: ${JSON.stringify(find)}`,
				);
			}
			continue;
		}
		result = result.split(find).join(replace);
	}
	return result;
}

async function pathExists(target) {
	try {
		await stat(target);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return false;
		throw error;
	}
}

async function collectFiles(dir) {
	const out = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await collectFiles(full)));
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
	return out;
}

// Returns the set of dest files (relative to the component dest root) that the
// sync would produce for one component, along with their expected Buffer/text
// content. Patched files carry their post-patch text.
async function deriveComponentFiles(component, patchIndex, matched) {
	const sourceRoot = join(SOURCE_COMPONENTS_ROOT, component);
	const replacementsByRel = patchIndex.get(component) ?? new Map();
	const files = new Map(); // relPath -> { content: Buffer, patched: boolean }

	const sourceFiles = [];
	const copyDirs = [...COPY_DIRS, ...(COPY_DIRS_BY_COMPONENT[component] ?? [])];
	for (const dirName of copyDirs) {
		const dirPath = join(sourceRoot, dirName);
		if (await pathExists(dirPath)) {
			sourceFiles.push(...(await collectFiles(dirPath)));
		}
	}
	for (const fileRel of COPY_FILES) {
		const filePath = join(sourceRoot, fileRel);
		if (await pathExists(filePath)) {
			sourceFiles.push(filePath);
		}
	}

	for (const sourcePath of sourceFiles) {
		const relPath = normalizeRel(relative(sourceRoot, sourcePath));
		const replacements = replacementsByRel.get(relPath);
		if (replacements && replacements.length > 0) {
			const sourceText = await readFile(sourcePath, "utf8");
			const patchedText = applyReplacements(component, relPath, sourceText, replacements, matched);
			files.set(relPath, { content: Buffer.from(patchedText, "utf8"), patched: true });
		} else {
			files.set(relPath, { content: await readFile(sourcePath), patched: false });
		}
	}

	// A required patch targeting a file that does not exist in the source is a
	// manifest bug — surface it loudly.
	for (const [relPath, replacements] of replacementsByRel.entries()) {
		if (files.has(relPath)) continue;
		const hasRequired = replacements.some((replacement) => replacement.required);
		if (hasRequired) {
			throw new PatchError(`patch target missing from source: ${component}/${relPath}`);
		}
	}

	return files;
}

async function writeComponent(component, files) {
	const destRoot = join(DEST_COMPONENTS_ROOT, component);
	await rm(destRoot, { recursive: true, force: true });
	for (const [relPath, { content }] of files) {
		const destPath = join(destRoot, relPath);
		await mkdir(dirname(destPath), { recursive: true });
		await writeFile(destPath, content);
	}
}

// Build artifacts and installed deps are not part of the synced source surface;
// `--check` compares source only, so these are ignored when reading the dest.
const DEST_IGNORED_PREFIXES = ["dist/", "node_modules/"];

async function readDestFiles(component) {
	const destRoot = join(DEST_COMPONENTS_ROOT, component);
	const files = new Map();
	if (!(await pathExists(destRoot))) return files;
	for (const fullPath of await collectFiles(destRoot)) {
		const relPath = normalizeRel(relative(destRoot, fullPath));
		if (DEST_IGNORED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) continue;
		files.set(relPath, await readFile(fullPath));
	}
	return files;
}

function diffComponent(component, expected, actual) {
	const drift = [];
	for (const [relPath, { content }] of expected) {
		const onDisk = actual.get(relPath);
		if (onDisk === undefined) {
			drift.push(`${component}/${relPath}: missing on disk`);
		} else if (!onDisk.equals(content)) {
			drift.push(`${component}/${relPath}: content differs`);
		}
	}
	for (const relPath of actual.keys()) {
		if (!expected.has(relPath)) {
			drift.push(`${component}/${relPath}: unexpected file on disk`);
		}
	}
	return drift;
}

export async function syncComponents(options = {}) {
	const check = options.check ?? false;
	const components =
		options.components && options.components.length > 0 ? options.components : HANDLED_COMPONENTS;

	for (const component of components) {
		if (!HANDLED_COMPONENTS.includes(component)) {
			throw new Error(
				`unknown component: ${component} (handled: ${HANDLED_COMPONENTS.join(", ")})`,
			);
		}
	}

	const patchIndex = buildPatchIndex(components);
	const matched = [];
	const drift = [];

	for (const component of components) {
		const expected = await deriveComponentFiles(component, patchIndex, matched);
		if (check) {
			const actual = await readDestFiles(component);
			drift.push(...diffComponent(component, expected, actual));
		} else {
			await writeComponent(component, expected);
		}
	}

	return { check, components, matched, drift };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args) {
	const parsed = { check: false, components: [] };
	for (const arg of args) {
		if (arg === "--check") {
			parsed.check = true;
			continue;
		}
		if (arg.startsWith("--")) {
			throw new Error(`unknown argument: ${arg}`);
		}
		parsed.components.push(arg);
	}
	return parsed;
}

function isNodeError(error) {
	return error instanceof Error && "code" in error;
}

async function main() {
	const { check, components } = parseArgs(process.argv.slice(2));
	const result = await syncComponents({ check, components });

	if (check) {
		if (result.drift.length > 0) {
			console.error("vendored components out of sync:");
			for (const line of result.drift) {
				console.error(`  - ${line}`);
			}
			process.exitCode = 1;
			return;
		}
		console.log(`vendored components in sync (${result.components.length} checked)`);
		return;
	}

	console.log(`synced components: ${result.components.join(", ")}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
