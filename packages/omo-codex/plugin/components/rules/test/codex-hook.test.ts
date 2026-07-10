import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostCompactInput,
	type CodexPostToolUseInput,
	type CodexSessionStartInput,
	runPostCompactHook,
	runPostToolUseHook,
	runSessionStartHook,
	runUserPromptSubmitHook,
} from "../src/codex-hook.js";

type CliResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

type SessionCache = {
	staticDedup?: string[];
	dynamicDedup?: Record<string, string[]>;
	dynamicTargetFingerprints?: Record<string, string>;
};

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const COMPONENT_ROOT = fileURLToPath(new URL("..", import.meta.url));

function runHookCli(input: string, subcommand = "post-tool-use", env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CLI_PATH, "hook", subcommand], {
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (exitCode) => {
			resolve({ exitCode, stdout, stderr });
		});
		child.stdin.end(input);
	});
}

const tempDirectories: string[] = [];
const PROJECT_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "CONTEXT.md,.omo/rules",
};

const AGENTS_AND_RULES_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "AGENTS.md,.omo/rules",
};

const CLAUDE_AND_RULES_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "CLAUDE.md,.omo/rules",
};

const RULES_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: ".omo/rules",
};

const DYNAMIC_BUNDLED_ONLY_ENV = {
	CODEX_RULES_MODE: "dynamic",
	CODEX_RULES_ENABLED_SOURCES: "plugin-bundled",
	PLUGIN_ROOT: COMPONENT_ROOT,
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeTempProject(): { root: string; pluginData: string } {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-project-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "AGENTS.md"), "Project AGENTS.md should stay Codex-native.");
	writeFileSync(path.join(root, "CLAUDE.md"), "Project CLAUDE.md should stay outside rules hook context.");
	writeFileSync(path.join(root, "CONTEXT.md"), "Always wear safety goggles when refactoring.");
	mkdirSync(path.join(root, ".omo", "rules"), { recursive: true });
	writeFileSync(
		path.join(root, ".omo", "rules", "typescript.md"),
		[
			"---",
			"description: TypeScript",
			'globs: ["**/*.ts", "**/*.tsx"]',
			"---",
			"",
			"Prefer strict TypeScript for all source files.",
		].join("\n"),
	);
	mkdirSync(path.join(root, "src"), { recursive: true });
	writeFileSync(path.join(root, "src", "app.ts"), "export const app = true;\n");
	writeFileSync(path.join(root, "src", "other.ts"), "export const other = true;\n");
	return { root, pluginData };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: "session-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function postCompactInput(root: string): CodexPostCompactInput {
	return {
		session_id: "session-1",
		turn_id: "turn-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "manual",
	};
}

function userPromptSubmitInput(
	root: string,
	transcriptPath: string | null = null,
): Parameters<typeof runUserPromptSubmitHook>[0] {
	return {
		session_id: "session-1",
		turn_id: "turn-1",
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "read src/app.ts",
	};
}

function postToolUseInput(root: string, filePath: string): CodexPostToolUseInput {
	return {
		session_id: "session-1",
		turn_id: "turn-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		tool_name: "mcp__filesystem__read_file",
		tool_input: { path: filePath },
		tool_response: { text: "file contents" },
		tool_use_id: "call-1",
	};
}

function parseHookOutput(output: string): {
	hookSpecificOutput?: {
		hookEventName?: string;
		additionalContext?: string;
	};
} {
	expect(output.trim().length).toBeGreaterThan(0);
	return JSON.parse(output) as {
		hookSpecificOutput?: {
			hookEventName?: string;
			additionalContext?: string;
		};
	};
}

function writeTranscriptWithContext(root: string, ...additionalContexts: string[]): string {
	const transcriptPath = path.join(root, "transcript.jsonl");
	writeFileSync(
		transcriptPath,
		`${additionalContexts
			.map((additionalContext) => JSON.stringify({ hookSpecificOutput: { additionalContext } }))
			.join("\n")}\n`,
	);
	return transcriptPath;
}

function occurrenceCount(value: string, search: string): number {
	return value.split(search).length - 1;
}

function sessionCacheFilePath(pluginData: string, sessionId = "session-1"): string {
	return path.join(pluginData, "sessions", `${sessionId}.json`);
}

function readSessionCache(pluginData: string): SessionCache {
	return JSON.parse(readFileSync(sessionCacheFilePath(pluginData), "utf8")) as SessionCache;
}

function writeTypeScriptRule(root: string, globExpression: string, body: string): void {
	writeFileSync(
		path.join(root, ".omo", "rules", "typescript.md"),
		["---", "description: TypeScript", `globs: ${globExpression}`, "---", "", body].join("\n"),
	);
}

describe("codex rules hooks", () => {
	it("#given project rules #when SessionStart runs #then emits static additional context", async () => {
		// given
		const { root, pluginData } = makeTempProject();

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		const parsed = parseHookOutput(output);
		expect(parsed.hookSpecificOutput?.hookEventName).toBe("SessionStart");
		expect(parsed.hookSpecificOutput?.additionalContext).toContain("## Project Instructions");
		expect(parsed.hookSpecificOutput?.additionalContext).toContain(
			`Instructions from: ${path.join(root, "CONTEXT.md")}`,
		);
		expect(parsed.hookSpecificOutput?.additionalContext).toContain("Always wear safety goggles");
	});

	it("#given default auto sources #when SessionStart runs #then native Codex AGENTS.md is not duplicated", async () => {
		// given
		const { root, pluginData } = makeTempProject();

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
		});

		// then
		const parsed = parseHookOutput(output);
		expect(parsed.hookSpecificOutput?.additionalContext).toContain("## Project Instructions");
		expect(parsed.hookSpecificOutput?.additionalContext).not.toContain("Project AGENTS.md should stay Codex-native.");
		expect(parsed.hookSpecificOutput?.additionalContext).not.toContain(
			"Project CLAUDE.md should stay outside rules hook context.",
		);
	});

	it("#given project AGENTS.md #when SessionStart runs #then rules hook leaves AGENTS.md to Codex native handling", async () => {
		// given
		const { root, pluginData } = makeTempProject();

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: AGENTS_AND_RULES_ENV,
		});

		// then
		expect(output).toBe("");
	});

	it("#given project CLAUDE.md #when SessionStart runs #then rules hook leaves CLAUDE.md out of context", async () => {
		// given
		const { root, pluginData } = makeTempProject();

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: CLAUDE_AND_RULES_ENV,
		});

		// then
		expect(output).toBe("");
	});

	it("#given static context already injected #when UserPromptSubmit runs #then it emits no duplicate context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		await runSessionStartHook(sessionStartInput(root), { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });

		// when
		const output = await runUserPromptSubmitHook(
			{
				session_id: "session-1",
				turn_id: "turn-1",
				transcript_path: null,
				cwd: root,
				hook_event_name: "UserPromptSubmit",
				model: "gpt-5.5",
				permission_mode: "default",
				prompt: "read src/app.ts",
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given resumed session #when SessionStart runs #then it preserves the session cache", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const input = sessionStartInput(root);
		await runSessionStartHook(input, { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });

		// when
		const resumeOutput = await runSessionStartHook(
			{ ...input, source: "resume" },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);
		const clearOutput = await runSessionStartHook(
			{ ...input, source: "clear" },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(resumeOutput).toBe("");
		const clearContext = parseHookOutput(clearOutput).hookSpecificOutput?.additionalContext ?? "";
		expect(clearContext).toContain("## Project Instructions");
		expect(clearContext).toContain(`Instructions from: ${path.join(root, "CONTEXT.md")}`);
		expect(clearContext).toContain("Always wear safety goggles");
	});

	it("#given static context remains in transcript but cache is missing #when SessionStart runs #then it emits no duplicate context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const firstOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const firstContext = parseHookOutput(firstOutput).hookSpecificOutput?.additionalContext ?? "";
		const transcriptPath = writeTranscriptWithContext(root, firstContext);
		rmSync(sessionCacheFilePath(pluginData), { force: true });

		// when
		const output = await runSessionStartHook(
			{ ...sessionStartInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
		expect(readSessionCache(pluginData).staticDedup).toHaveLength(1);
	});

	it("#given read-file tool result #when PostToolUse runs #then emits matching dynamic rule context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");

		// when
		const output = await runPostToolUseHook(postToolUseInput(root, filePath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		// The literal "src/app.ts" pins POSIX separators and acts as the Windows
		// regression line: prior versions emitted "src\\app.ts" on Windows.
		const parsed = parseHookOutput(output);
		expect(parsed.hookSpecificOutput?.hookEventName).toBe("PostToolUse");
		expect(parsed.hookSpecificOutput?.additionalContext).toContain(
			"Additional project instructions matched for src/app.ts",
		);
		expect(parsed.hookSpecificOutput?.additionalContext).toContain("Prefer strict TypeScript");
		expect(parsed.hookSpecificOutput?.additionalContext ?? "").not.toContain("src\\app.ts");
		expect(output).not.toContain("updatedMCPToolOutput");
		expect(output).not.toContain("suppressOutput");
		expect(output).not.toContain('"decision"');
	});

	it("#given multiple target paths matching one rule #when PostToolUse runs #then emits dynamic context once for the first target", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const firstFilePath = path.join(root, "src", "app.ts");
		const secondFilePath = path.join(root, "src", "other.ts");

		// when
		const output = await runPostToolUseHook(
			{
				...postToolUseInput(root, firstFilePath),
				tool_name: "mcp__filesystem__read_multiple_files",
				tool_input: { paths: [firstFilePath, secondFilePath, firstFilePath] },
			},
			{
				pluginDataRoot: pluginData,
				env: PROJECT_ONLY_ENV,
			},
		);

		// then
		const parsed = parseHookOutput(output);
		const additionalContext = parsed.hookSpecificOutput?.additionalContext ?? "";
		expect(parsed.hookSpecificOutput?.hookEventName).toBe("PostToolUse");
		expect(additionalContext).toContain("Additional project instructions matched for src/app.ts");
		expect(additionalContext).not.toContain("src\\app.ts");
		expect(occurrenceCount(additionalContext, "Prefer strict TypeScript")).toBe(1);
	});

	it("#given dynamic context already injected #when PostToolUse repeats #then emits no duplicate context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const input = postToolUseInput(root, filePath);
		await runPostToolUseHook(input, { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });
		const cachedState = readSessionCache(pluginData);

		// when
		const output = await runPostToolUseHook(input, { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });

		// then
		expect(output).toBe("");
		expect(Object.keys(cachedState.dynamicTargetFingerprints ?? {})).toHaveLength(1);
		expect(readSessionCache(pluginData).dynamicTargetFingerprints).toEqual(cachedState.dynamicTargetFingerprints);
	});

	it("#given bundled dynamic rules already injected for gpt-5.5 #when same target switches to gpt-5.6 #then emits the gpt-5.6 rule", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const input = postToolUseInput(root, filePath);
		const firstOutput = await runPostToolUseHook(input, {
			pluginDataRoot: pluginData,
			env: DYNAMIC_BUNDLED_ONLY_ENV,
		});

		// when
		const secondOutput = await runPostToolUseHook(
			{ ...input, model: "gpt-5.6-codex" },
			{ pluginDataRoot: pluginData, env: DYNAMIC_BUNDLED_ONLY_ENV },
		);

		// then
		const firstContext = parseHookOutput(firstOutput).hookSpecificOutput?.additionalContext ?? "";
		const secondContext = parseHookOutput(secondOutput).hookSpecificOutput?.additionalContext ?? "";
		expect(firstContext).toContain("based on GPT-5.5");
		expect(firstContext).not.toContain("based on GPT-5.6");
		expect(secondContext).toContain("based on GPT-5.6");
		expect(secondContext).not.toContain("based on GPT-5.5");
	});

	it("#given default auto sources #when excluded AGENTS.md changes #then PostToolUse fingerprint stays stable", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const input = postToolUseInput(root, filePath);
		await runPostToolUseHook(input, { pluginDataRoot: pluginData });
		const cachedState = readSessionCache(pluginData);
		writeFileSync(path.join(root, "AGENTS.md"), "Native Codex instructions changed outside codex-rules auto.");

		// when
		const output = await runPostToolUseHook(input, { pluginDataRoot: pluginData });

		// then
		expect(output).toBe("");
		expect(readSessionCache(pluginData).dynamicTargetFingerprints).toEqual(cachedState.dynamicTargetFingerprints);
	});

	it("#given dynamic context remains in transcript but cache is missing #when PostToolUse repeats #then it emits no duplicate context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const input = postToolUseInput(root, filePath);
		const firstOutput = await runPostToolUseHook(input, { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });
		const firstContext = parseHookOutput(firstOutput).hookSpecificOutput?.additionalContext ?? "";
		const transcriptPath = writeTranscriptWithContext(root, firstContext);
		rmSync(sessionCacheFilePath(pluginData), { force: true });

		// when
		const output = await runPostToolUseHook(
			{ ...input, transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		const cachedState = readSessionCache(pluginData);
		expect(output).toBe("");
		expect(Object.values(cachedState.dynamicDedup ?? {}).flat()).toHaveLength(2);
		expect(Object.keys(cachedState.dynamicTargetFingerprints ?? {})).toHaveLength(1);
	});

	it("#given cached target in one session #when another session reads it #then PostToolUse rechecks independently", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		await runPostToolUseHook(postToolUseInput(root, filePath), { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });

		// when
		const output = await runPostToolUseHook(
			{ ...postToolUseInput(root, filePath), session_id: "session-2" },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(parseHookOutput(output).hookSpecificOutput?.additionalContext).toContain("Prefer strict TypeScript");
	});

	it("#given cached dynamic target #when rule frontmatter changes #then PostToolUse rechecks the target", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const input = postToolUseInput(root, filePath);
		await runPostToolUseHook(input, { pluginDataRoot: pluginData, env: RULES_ONLY_ENV });
		writeTypeScriptRule(root, '"**/*.ts"', "Prefer readonly TypeScript after rule edits.");

		// when
		const output = await runPostToolUseHook(input, { pluginDataRoot: pluginData, env: RULES_ONLY_ENV });

		// then
		expect(parseHookOutput(output).hookSpecificOutput?.additionalContext).toContain(
			"Prefer readonly TypeScript after rule edits.",
		);
	});

	it("#given cached dynamic context #when PostCompact runs #then PostToolUse emits no duplicate dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const input = postToolUseInput(root, filePath);
		const firstOutput = await runPostToolUseHook(input, { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });
		const firstContext = parseHookOutput(firstOutput).hookSpecificOutput?.additionalContext ?? "";
		const transcriptPath = writeTranscriptWithContext(root, firstContext);
		expect(
			await runPostToolUseHook(
				{ ...input, transcript_path: transcriptPath },
				{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
			),
		).toBe("");

		// when
		const compactOutput = await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);
		const output = await runPostToolUseHook(
			{ ...input, transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(compactOutput).toBe("");
		expect(output).toBe("");
	});

	it("#given cached static and dynamic context #when static recovery runs before dynamic #then neither emits duplicate context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const staticOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const dynamicOutput = await runPostToolUseHook(postToolUseInput(root, filePath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeTranscriptWithContext(
			root,
			parseHookOutput(staticOutput).hookSpecificOutput?.additionalContext ?? "",
			parseHookOutput(dynamicOutput).hookSpecificOutput?.additionalContext ?? "",
		);
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const staticReinjectOutput = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const dynamicReinjectOutput = await runPostToolUseHook(
			{ ...postToolUseInput(root, filePath), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(staticReinjectOutput).toBe("");
		expect(dynamicReinjectOutput).toBe("");
	});

	it("#given cached static and dynamic context #when dynamic recovery runs before static #then neither emits duplicate context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const staticOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const dynamicOutput = await runPostToolUseHook(postToolUseInput(root, filePath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeTranscriptWithContext(
			root,
			parseHookOutput(staticOutput).hookSpecificOutput?.additionalContext ?? "",
			parseHookOutput(dynamicOutput).hookSpecificOutput?.additionalContext ?? "",
		);
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const dynamicReinjectOutput = await runPostToolUseHook(
			{ ...postToolUseInput(root, filePath), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);
		const staticReinjectOutput = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		expect(dynamicReinjectOutput).toBe("");
		expect(staticReinjectOutput).toBe("");
	});

	it("#given legacy session cache #when PostToolUse hydrates state #then it accepts the old shape", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		mkdirSync(path.join(pluginData, "sessions"), { recursive: true });
		writeFileSync(sessionCacheFilePath(pluginData), `${JSON.stringify({ staticDedup: [], dynamicDedup: {} })}\n`);

		// when
		const output = await runPostToolUseHook(postToolUseInput(root, path.join(root, "src", "app.ts")), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		expect(parseHookOutput(output).hookSpecificOutput?.additionalContext).toContain("Prefer strict TypeScript");
	});

	it("#given static-only mode #when PostToolUse runs #then emits no dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");

		// when
		const output = await runPostToolUseHook(postToolUseInput(root, filePath), {
			pluginDataRoot: pluginData,
			env: {
				...PROJECT_ONLY_ENV,
				CODEX_RULES_MODE: "static",
			},
		});

		// then
		expect(output).toBe("");
	});

	it("#given rules disabled #when PostToolUse runs #then emits no dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");

		// when
		const output = await runPostToolUseHook(postToolUseInput(root, filePath), {
			pluginDataRoot: pluginData,
			env: {
				...PROJECT_ONLY_ENV,
				CODEX_RULES_DISABLED: "true",
			},
		});

		// then
		expect(output).toBe("");
	});

	it("#given failed tool response #when PostToolUse runs #then emits no dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");

		// when
		const output = await runPostToolUseHook(
			{
				...postToolUseInput(root, filePath),
				tool_response: { is_error: true },
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given tracked tool without path #when PostToolUse runs #then emits no dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();

		// when
		const output = await runPostToolUseHook(
			{
				...postToolUseInput(root, ""),
				tool_input: {},
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given malformed post-tool-use stdin #when hook CLI runs #then it no-ops without stderr", async () => {
		// given
		const input = "break;\n";

		// when
		const result = await runHookCli(input);

		// then
		expect(result).toEqual({
			exitCode: 0,
			stdout: "",
			stderr: "",
		});
	});

	it("#given non-object post-tool-use JSON #when hook CLI runs #then it no-ops without stderr", async () => {
		// given
		const input = "[]\n";

		// when
		const result = await runHookCli(input);

		// then
		expect(result).toEqual({
			exitCode: 0,
			stdout: "",
			stderr: "",
		});
	});

	it("#given debug timing enabled #when PostToolUse hook CLI runs #then phase logs go to stderr only", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const input = `${JSON.stringify(postToolUseInput(root, path.join(root, "src", "app.ts")))}\n`;

		// when
		const result = await runHookCli(input, "post-tool-use", {
			NODE_DEBUG: "codex-rules",
			PLUGIN_DATA: pluginData,
		});

		// then
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hookSpecificOutput");
		expect(result.stderr).toContain("PostToolUse");
		expect(result.stderr).toContain("extract");
		expect(result.stderr).toContain("fingerprint");
		expect(result.stderr).toContain("load");
		expect(result.stderr).toContain("persist");
		expect(result.stderr).toContain("ms");
	});

	it("#given malformed post-compact stdin #when hook CLI runs #then it no-ops without stderr", async () => {
		// given
		const input = `${JSON.stringify({ hook_event_name: "PostCompact", session_id: "s", turn_id: "t" })}\n`;

		// when
		const result = await runHookCli(input, "post-compact");

		// then
		expect(result).toEqual({
			exitCode: 0,
			stdout: "",
			stderr: "",
		});
	});
});
