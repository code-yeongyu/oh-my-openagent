#!/usr/bin/env node
/**
 * Generates the CodeBuddy agent definitions from omo's own agent sources.
 *
 * The prompts are EXTRACTED, never retyped: a template literal is read out of
 * the OpenCode agent module (or, for Prometheus, straight out of
 * `prompts-core`). Runtime interpolations (`${...}`) are dropped and reported,
 * so what ships is the model-visible static part of the agent prompt.
 *
 * Only subagent-shaped agents are exported. `sisyphus`, `hephaestus` and
 * `atlas` are primary agents whose prompts are assembled at runtime from model
 * metadata, tool tables and category lists — exporting them would ship a
 * degenerate prompt that pretends to be the real one.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, "..", "..");
const targetDir = join(packageRoot, "plugin", "agents");

const READ_ONLY_TOOLS = "Read, Grep, Glob";
const RESEARCH_TOOLS = "Read, Grep, Glob, WebFetch, WebSearch";

export const AGENT_SOURCES = [
	{
		name: "oracle",
		description:
			"Strategic technical advisor with deep reasoning for architecture decisions, code analysis, and engineering guidance. Use when a task needs a second, rigorous opinion or a plan is too risky to take at face value.",
		tools: `${READ_ONLY_TOOLS}, WebFetch`,
		source: "packages/omo-opencode/src/agents/oracle.ts",
		extract: { kind: "const", symbol: "ORACLE_DEFAULT_PROMPT" },
	},
	{
		name: "explore",
		description:
			"Codebase search specialist: finds files, symbols, and patterns and returns absolute paths with a direct answer. Use for \"where is X\", \"which files do Y\", or unfamiliar-module mapping.",
		tools: `${READ_ONLY_TOOLS}, Bash`,
		source: "packages/omo-opencode/src/agents/explore.ts",
		extract: { kind: "field", field: "prompt" },
	},
	{
		name: "librarian",
		description:
			"External research specialist: reads open-source repositories, documentation, and release notes, then reports implementation examples with sources. Use for questions about libraries, APIs, or how another project solved this.",
		tools: RESEARCH_TOOLS,
		source: "packages/omo-opencode/src/agents/librarian.ts",
		extract: { kind: "field", field: "prompt" },
	},
	{
		name: "multimodal-looker",
		description:
			"Analyzes attached images, PDFs, and other media that cannot be read as plain text, and reports what they contain. Use whenever the request depends on a visual or binary artifact.",
		tools: "Read",
		source: "packages/omo-opencode/src/agents/multimodal-looker.ts",
		extract: { kind: "field", field: "prompt" },
	},
	{
		name: "metis",
		description:
			"Pre-planning consultant that pressure-tests a request before implementation starts: surfaces hidden assumptions, missing constraints, and the questions a plan must answer.",
		tools: READ_ONLY_TOOLS,
		source: "packages/omo-opencode/src/agents/metis.ts",
		extract: { kind: "const", symbol: "METIS_SYSTEM_PROMPT" },
	},
	{
		name: "momus",
		description:
			"Work-plan reviewer that verifies a written plan is executable and its references are real, and returns a blocking verdict with specific gaps. Use before starting work from a plan.",
		tools: READ_ONLY_TOOLS,
		source: "packages/omo-opencode/src/agents/momus.ts",
		extract: { kind: "const", symbol: "MOMUS_DEFAULT_PROMPT" },
	},
	{
		name: "prometheus",
		description:
			"Planning orchestrator: interviews the user, explores the codebase, and writes one decision-complete work plan with verifiable success criteria. Use for planning requests the ulw-plan skill routes here.",
		tools: `${READ_ONLY_TOOLS}, WebFetch`,
		source: "packages/prompts-core/prompts/prometheus/default.md",
		extract: { kind: "file" },
	},
];

/** Reads a template literal starting at the first backtick after `from`. */
export function extractTemplateLiteral(source, from) {
	const start = source.indexOf("`", from);
	if (start === -1) return null;
	let out = "";
	for (let index = start + 1; index < source.length; index += 1) {
		const char = source[index];
		if (char === "\\") {
			out += source[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (char === "`") return out;
		out += char;
	}
	return null;
}

export function extractPrompt(moduleSource, extract) {
	if (extract.kind === "file") return moduleSource;
	if (extract.kind === "const") {
		const match = new RegExp(`(?:export\\s+)?const\\s+${extract.symbol}\\s*=`).exec(moduleSource);
		if (match === null) return null;
		return extractTemplateLiteral(moduleSource, match.index);
	}
	const match = new RegExp(`\\b${extract.field}\\s*:`).exec(moduleSource);
	if (match === null) return null;
	return extractTemplateLiteral(moduleSource, match.index);
}

/** Drops runtime interpolations and collapses the blank lines they leave. */
export function stripRuntimeInterpolations(prompt) {
	return prompt
		.replace(/\$\{[^}]*\}/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function renderAgent(spec, body) {
	return [
		"---",
		`name: ${spec.name}`,
		`description: ${spec.description}`,
		`tools: ${spec.tools}`,
		"---",
		"",
		body,
		"",
	].join("\n");
}

export async function generateAgents({ check = false } = {}) {
	const rendered = new Map();
	const notes = [];

	for (const spec of AGENT_SOURCES) {
		const sourcePath = join(repoRoot, spec.source);
		const moduleSource = await readFile(sourcePath, "utf8");
		const raw = extractPrompt(moduleSource, spec.extract);
		if (raw === null) throw new Error(`could not extract the prompt for ${spec.name} from ${spec.source}`);
		const body = stripRuntimeInterpolations(raw);
		if (body.length < 200) throw new Error(`extracted prompt for ${spec.name} is suspiciously short`);
		if (/\$\{/.test(body)) throw new Error(`unresolved interpolation left in ${spec.name}`);
		if (raw.includes("${")) notes.push(`${spec.name}: dropped runtime interpolation(s)`);
		rendered.set(`${spec.name}.md`, renderAgent(spec, body));
	}

	if (check) {
		for (const [file, expected] of rendered) {
			let actual = null;
			try {
				actual = await readFile(join(targetDir, file), "utf8");
			} catch {
				throw new Error(`agent file missing: ${file}`);
			}
			if (actual !== expected) throw new Error(`agent file is stale: ${file}`);
		}
		return { agents: [...rendered.keys()], notes };
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	for (const [file, content] of rendered) {
		await writeFile(join(targetDir, file), content, "utf8");
	}
	return { agents: [...rendered.keys()], notes };
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const { agents, notes } = await generateAgents({ check });
	console.log(check ? `agent check passed (${agents.length})` : `generated ${agents.length} agents: ${agents.join(", ")}`);
	for (const note of notes) console.log(`note: ${note}`);
}
