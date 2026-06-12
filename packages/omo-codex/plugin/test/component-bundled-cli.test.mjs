import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { readJson, root } from "./aggregate-plugin-fixture.mjs";

const HOOK_EVENTS_BY_COMPONENT = {
	"comment-checker": "post-tool-use",
	"git-bash": "pre-tool-use",
	lsp: "post-compact",
	rules: "session-start",
	"start-work-continuation": "stop",
	telemetry: "session-start",
	ultrawork: "user-prompt-submit",
	"ulw-loop": "pre-tool-use",
};

test("#given built workspace component CLIs #when import specifiers are inspected #then each CLI is self-contained except node builtins", async () => {
	// given
	const components = await workspaceComponents();

	// when
	const invalidImports = [];
	for (const component of components) {
		const cliSource = await readFile(componentCliPath(component), "utf8");
		const imports = collectModuleImports(cliSource);
		const invalidForComponent = imports.filter((specifier) => !specifier.startsWith("node:"));
		for (const specifier of invalidForComponent) {
			invalidImports.push(`${component}: ${specifier}`);
		}
	}

	// then
	assert.deepEqual(invalidImports, []);
});

test("#given built workspace component CLIs #when dynamically imported with hook argv and empty stdin #then each CLI loads without external module resolution", async () => {
	// given
	const components = await workspaceComponents();

	// when
	const failures = [];
	for (const component of components) {
		const result = smokeImportComponent(component, HOOK_EVENTS_BY_COMPONENT[component]);
		if (result.status !== 0) {
			failures.push(`${component}: exit=${result.status} stderr=${result.stderr.trim()}`);
		}
	}

	// then
	assert.deepEqual(failures, []);
});

test("#given representative component hook payloads #when executed through dist CLI contract #then current hook behavior is preserved", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-cli-contract-"));
	try {
		const cases = [
			{
				name: "rules session-start",
				component: "rules",
				event: "session-start",
				payload: {
					hook_event_name: "SessionStart",
					session_id: "s-task12",
					transcript_path: null,
					cwd: tempRoot,
					model: "gpt-5.5",
					permission_mode: "default",
					source: "startup",
				},
				assertOutput(stdout) {
					const output = JSON.parse(stdout);
					assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
					assert.match(output.hookSpecificOutput.additionalContext, /Hephaestus/);
				},
			},
			{
				name: "telemetry session-start opt-out",
				component: "telemetry",
				event: "session-start",
				payload: {
					hook_event_name: "SessionStart",
					session_id: "s-task12",
					transcript_path: null,
					cwd: tempRoot,
					model: "gpt-5.5",
					permission_mode: "default",
					source: "startup",
				},
				assertOutput(stdout) {
					assert.equal(stdout, "");
				},
			},
			{
				name: "ultrawork user-prompt-submit trigger",
				component: "ultrawork",
				event: "user-prompt-submit",
				payload: {
					hook_event_name: "UserPromptSubmit",
					session_id: "s-task12",
					turn_id: "t-task12",
					transcript_path: null,
					cwd: tempRoot,
					model: "gpt-5.5",
					permission_mode: "default",
					prompt: "please ultrawork this",
				},
				assertOutput(stdout) {
					const output = JSON.parse(stdout);
					assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
					assert.match(output.hookSpecificOutput.additionalContext, /<ultrawork-mode>/);
				},
			},
			{
				name: "ulw-loop pre-tool-use budget guard",
				component: "ulw-loop",
				event: "pre-tool-use",
				payload: {
					hook_event_name: "PreToolUse",
					session_id: "s-task12",
					turn_id: "t-task12",
					transcript_path: null,
					cwd: tempRoot,
					model: "gpt-5.5",
					permission_mode: "default",
					tool_name: "create_goal",
					tool_use_id: "tool-task12",
					tool_input: { objective: "x", token_budget: 100 },
				},
				assertOutput(stdout) {
					const output = JSON.parse(stdout);
					assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
					assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
					assert.match(output.hookSpecificOutput.additionalContext, /Omit token_budget/);
				},
			},
			{
				name: "git-bash pre-tool-use windows reminder",
				component: "git-bash",
				event: "pre-tool-use",
				payload: {
					hook_event_name: "PreToolUse",
					session_id: "s-task12-windows",
					turn_id: "t-task12",
					transcript_path: null,
					cwd: tempRoot,
					model: "gpt-5.5",
					permission_mode: "default",
					tool_name: "Bash",
					tool_use_id: "tool-task12",
					tool_input: { cmd: "pwd" },
				},
				env: { OS: "Windows_NT" },
				assertOutput(stdout) {
					const output = JSON.parse(stdout);
					assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
					assert.match(output.hookSpecificOutput.additionalContext, /git_bash MCP/);
				},
			},
			{
				name: "comment-checker post-tool-use no requests",
				component: "comment-checker",
				event: "post-tool-use",
				payload: {
					hook_event_name: "PostToolUse",
					session_id: "s-task12",
					turn_id: "t-task12",
					transcript_path: null,
					cwd: tempRoot,
					model: "gpt-5.5",
					permission_mode: "default",
					tool_name: "Read",
					tool_use_id: "tool-task12",
					tool_input: {},
					tool_response: { text: "ok" },
				},
				assertOutput(stdout) {
					assert.equal(stdout, "");
				},
			},
			{
				name: "lsp post-compact reset",
				component: "lsp",
				event: "post-compact",
				payload: {
					hook_event_name: "PostCompact",
					session_id: "s-task12",
					turn_id: "t-task12",
					transcript_path: null,
					cwd: tempRoot,
					model: "gpt-5.5",
					trigger: "manual",
				},
				assertOutput(stdout) {
					assert.equal(stdout, "");
				},
			},
			{
				name: "start-work-continuation stop no state",
				component: "start-work-continuation",
				event: "stop",
				payload: {
					hook_event_name: "Stop",
					session_id: "s-task12",
					turn_id: "t-task12",
					transcript_path: join(tempRoot, "transcript.jsonl"),
					cwd: tempRoot,
					model: "gpt-5.5",
					permission_mode: "default",
					stop_hook_active: false,
				},
				assertOutput(stdout) {
					assert.equal(stdout, "");
				},
			},
		];

		for (const hookCase of cases) {
			const result = runHookCli(hookCase.component, hookCase.event, hookCase.payload, tempRoot, hookCase.env);
			assert.equal(result.status, 0, `${hookCase.name} exited ${result.status}: ${result.stderr}`);
			assert.equal(result.stderr, "", `${hookCase.name} stderr`);
			hookCase.assertOutput(result.stdout);
		}
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("#given malformed comment-checker stdin #when executed through dist CLI contract #then it exits successfully without output", () => {
	// given
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-cli-malformed-"));
	try {
		// when
		const result = runHookCliRaw("comment-checker", "post-tool-use", "not-json", tempRoot);

		// then
		assert.equal(result.status, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "");
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("#given aggregate hook manifest #when command hooks are inspected #then component CLI invocation contract is unchanged", async () => {
	// given
	const hooks = await readJson("hooks/hooks.json");
	const commands = collectHookCommands(hooks.hooks);
	const components = await workspaceComponents();

	// when
	const missingContracts = components.filter(
		(component) =>
			!commands.some((command) =>
				command.startsWith(`node "\${PLUGIN_ROOT}/components/${component}/dist/cli.js" hook `),
			),
	);

	// then
	assert.deepEqual(missingContracts, []);
});

async function workspaceComponents() {
	const packageJson = await readJson("package.json");
	return packageJson.workspaces
		.filter((workspace) => workspace.startsWith("components/"))
		.map((workspace) => workspace.slice("components/".length))
		.sort();
}

function collectModuleImports(source) {
	return [
		...source.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g),
		...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
	].map((match) => match[1]);
}

function collectHookCommands(hooksByEvent) {
	const commands = [];
	for (const groups of Object.values(hooksByEvent)) {
		for (const group of groups) {
			for (const hook of group.hooks) {
				if (hook.type === "command") commands.push(hook.command);
			}
		}
	}
	return commands;
}

function componentCliPath(component) {
	return join(root, "components", component, "dist", "cli.js");
}

function runHookCli(component, event, payload, tempRoot, extraEnv = {}) {
	return runHookCliRaw(component, event, `${JSON.stringify(payload)}\n`, tempRoot, extraEnv);
}

function runHookCliRaw(component, event, input, tempRoot, extraEnv = {}) {
	return spawnSync(process.execPath, [componentCliPath(component), "hook", event], {
		cwd: root,
		encoding: "utf8",
		env: hookEnv(tempRoot, extraEnv),
		input,
		timeout: 15_000,
	});
}

function smokeImportComponent(component, event) {
	const cliPath = componentCliPath(component);
	const script = `
		import { pathToFileURL } from "node:url";
		process.argv = [process.execPath, ${JSON.stringify(cliPath)}, "hook", ${JSON.stringify(event)}];
		await import(pathToFileURL(${JSON.stringify(cliPath)}).href);
		if (process.exitCode !== undefined && process.exitCode !== 0) process.exit(process.exitCode);
	`;
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-cli-import-"));
	try {
		return spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
			cwd: root,
			encoding: "utf8",
			env: hookEnv(tempRoot),
			input: "",
			timeout: 15_000,
		});
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

function hookEnv(tempRoot, extraEnv = {}) {
	return {
		...process.env,
		...extraEnv,
		HOME: join(tempRoot, "home"),
		PLUGIN_DATA: join(tempRoot, "plugin-data"),
		OMO_CODEX_DISABLE_POSTHOG: "1",
		OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "0",
	};
}
