import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runLspPostToolUseHook } from "../src/codex-hook.js";

interface DaemonResult {
	readonly content: readonly { readonly type: string; readonly text?: string }[];
	readonly details?: unknown;
}

const daemonResults = vi.hoisted(() => new Map<string, DaemonResult>());

vi.mock("@code-yeongyu/lsp-daemon/client", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	callDiagnosticsViaDaemon: async (filePath: string) => {
		const result = daemonResults.get(filePath);
		if (result === undefined) throw new Error(`unexpected diagnostics request for ${filePath}`);
		return result;
	},
}));

const UNDECIDED_TEXT = [
	"LSP server 'biome' for .json, .jsonc is NOT INSTALLED.",
	"",
	"Command not found: biome",
	"",
	"To install, run:",
	"  npm install -g @biomejs/biome",
].join("\n");
const DECLINED_TEXT =
	"LSP server 'biome' (.json, .jsonc) is NOT INSTALLED; user previously declined installation — proceed without LSP.";
const TS_ERROR = "error[typescript] (2322) at 1:7: Type 'string' is not assignable to type 'number'.";

const tempDirs: string[] = [];

afterEach(() => {
	daemonResults.clear();
	for (const tempDir of tempDirs.splice(0)) rmSync(tempDir, { recursive: true, force: true });
});

describe("codex PostToolUse hook with a language server that is not installed", () => {
	it("#given biome is not installed and the user has not decided #when a .json file is edited #then the install guidance is a note, not a block", async () => {
		// given
		daemonAnswering({ "config.json": biomeNotInstalled(null, UNDECIDED_TEXT) });

		// when
		const output = await withPluginData(() => runLspPostToolUseHook(editOf("s-undecided", "config.json")));

		// then
		const parsed = parseHookOutput(output);
		expect(parsed["decision"]).toBeUndefined();
		expect(parsed["reason"]).toBeUndefined();
		expect(additionalContext(parsed)).toContain("npm install -g @biomejs/biome");
	});

	it("#given the user declined biome #when a .json file is edited #then the hook does not block", async () => {
		// given
		daemonAnswering({ "config.json": biomeNotInstalled("declined", DECLINED_TEXT) });

		// when
		const output = await withPluginData(() => runLspPostToolUseHook(editOf("s-declined", "config.json")));

		// then
		const parsed = parseHookOutput(output);
		expect(parsed["decision"]).toBeUndefined();
		expect(additionalContext(parsed)).toContain("proceed without LSP");
	});

	it("#given biome is not installed #when the same session edits .json twice #then neither edit is blocked", async () => {
		// given
		daemonAnswering({ "config.json": biomeNotInstalled(null, UNDECIDED_TEXT) });

		// when
		const outputs = await withPluginData(async () => [
			await runLspPostToolUseHook(editOf("s-repeat", "config.json")),
			await runLspPostToolUseHook(editOf("s-repeat", "config.json")),
		]);

		// then
		for (const output of outputs) expect(parseHookOutput(output)["decision"]).toBeUndefined();
	});

	it("#given one edit touches a .json without biome and a .ts with a type error #when the hook runs #then the type error still blocks", async () => {
		// given
		daemonAnswering({
			"config.json": biomeNotInstalled(null, UNDECIDED_TEXT),
			"src/value.ts": diagnosticsText(TS_ERROR),
		});

		// when
		const output = await withPluginData(() =>
			runLspPostToolUseHook(patchOf("s-mixed", ["config.json", "src/value.ts"])),
		);

		// then
		const parsed = parseHookOutput(output);
		expect(parsed["decision"]).toBe("block");
		expect(parsed["reason"]).toContain(TS_ERROR);
	});

	it("#given only a real type error #when a .ts file is edited #then the hook blocks with the diagnostic", async () => {
		// given
		daemonAnswering({ "src/value.ts": diagnosticsText(TS_ERROR) });

		// when
		const output = await withPluginData(() => runLspPostToolUseHook(editOf("s-real", "src/value.ts")));

		// then
		const parsed = parseHookOutput(output);
		expect(parsed["decision"]).toBe("block");
		expect(parsed["reason"]).toContain(TS_ERROR);
	});
});

function daemonAnswering(results: Readonly<Record<string, DaemonResult>>): void {
	for (const [filePath, result] of Object.entries(results)) daemonResults.set(filePath, result);
}

function biomeNotInstalled(decision: "declined" | null, text: string): DaemonResult {
	return {
		content: [{ type: "text", text }],
		details: {
			error: text,
			errorKind: "missing_dependency",
			availability: {
				kind: "not_installed",
				serverId: "biome",
				command: ["biome", "lsp-proxy"],
				extensions: [".json", ".jsonc"],
				installHint: "npm install -g @biomejs/biome",
				installDecisionTool: true,
				installDecisionsPath: "/codex-home/lsp-install-decisions.json",
				decision,
			},
		},
	};
}

function diagnosticsText(text: string): DaemonResult {
	return { content: [{ type: "text", text }] };
}

function editOf(sessionId: string, filePath: string) {
	return hookInput(sessionId, "write", { path: filePath });
}

function patchOf(sessionId: string, filePaths: readonly string[]) {
	const command = [
		"*** Begin Patch",
		...filePaths.flatMap((file) => [`*** Update File: ${file}`, "@@", "-a", "+b"]),
		"*** End Patch",
	];
	return hookInput(sessionId, "apply_patch", { command: command.join("\n") });
}

function hookInput(sessionId: string, toolName: string, toolInput: Record<string, unknown>) {
	return {
		cwd: "/repo",
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		session_id: sessionId,
		tool_input: toolInput,
		tool_name: toolName,
		tool_response: { ok: true },
		tool_use_id: "tool-use-1",
		transcript_path: null,
		turn_id: "turn-1",
	};
}

async function withPluginData<T>(fn: () => Promise<T>): Promise<T> {
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-lsp-not-installed-"));
	tempDirs.push(pluginData);
	const previous = process.env["PLUGIN_DATA"];
	process.env["PLUGIN_DATA"] = pluginData;
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env["PLUGIN_DATA"];
		else process.env["PLUGIN_DATA"] = previous;
	}
}

function parseHookOutput(output: string): Record<string, unknown> {
	expect(output).not.toBe("");
	const parsed: unknown = JSON.parse(output);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		throw new Error(`hook output is not an object: ${output}`);
	return { ...parsed };
}

function additionalContext(parsed: Record<string, unknown>): string {
	const specific = parsed["hookSpecificOutput"];
	if (typeof specific !== "object" || specific === null) throw new Error("hookSpecificOutput missing");
	const context = Reflect.get(specific, "additionalContext");
	const eventName = Reflect.get(specific, "hookEventName");
	expect(eventName).toBe("PostToolUse");
	if (typeof context !== "string") throw new Error("additionalContext missing");
	return context;
}
