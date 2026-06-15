import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import { readJson, root } from "./aggregate-plugin-fixture.mjs";
import { componentHookContractCases } from "./component-hook-contract-cases.mjs";

const HOOK_EVENTS_BY_COMPONENT = {
	"comment-checker": "post-tool-use",
	"git-bash": "pre-tool-use",
	"lazycodex-executor-verify": "subagent-stop",
	lsp: "post-compact",
	rules: "session-start",
	"start-work-continuation": "stop",
	telemetry: "session-start",
	ultrawork: "user-prompt-submit",
	"ulw-loop": "pre-tool-use",
};
const HOOK_CLI_TEST_TIMEOUT_MS = 45_000;

test("#given required component CLI contracts #when workspaces are inspected #then every contract component is covered", async () => {
	// given
	const components = await workspaceComponents();

	// when
	const missingWorkspaceComponents = Object.keys(HOOK_EVENTS_BY_COMPONENT).filter(
		(component) => !components.includes(component),
	);

	// then
	assert.deepEqual(missingWorkspaceComponents, []);
});

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

test("#given representative component hook payloads #when executed through dist CLI contract #then current hook behavior is preserved", async () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-cli-contract-"));
	try {
		const cases = componentHookContractCases(tempRoot);

		for (const hookCase of cases) {
			const result = await runHookCli(hookCase.component, hookCase.event, hookCase.payload, tempRoot, hookCase.env);
			assert.equal(
				result.status,
				0,
				`${hookCase.name} exited ${result.status} signal=${result.signal} error=${result.error?.message ?? ""}: ${result.stderr}`,
			);
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
	return runHookCliAsync(component, event, `${JSON.stringify(payload)}\n`, tempRoot, extraEnv);
}

function runHookCliRaw(component, event, input, tempRoot, extraEnv = {}) {
	return spawnSync(process.execPath, [componentCliPath(component), "hook", event], {
		cwd: root,
		encoding: "utf8",
		env: hookEnv(tempRoot, extraEnv),
		input,
		timeout: HOOK_CLI_TEST_TIMEOUT_MS,
	});
}

function runHookCliAsync(component, event, input, tempRoot, extraEnv = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [componentCliPath(component), "hook", event], {
			cwd: root,
			env: hookEnv(tempRoot, extraEnv),
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error(`${component} ${event} timed out after ${HOOK_CLI_TEST_TIMEOUT_MS}ms`));
		}, HOOK_CLI_TEST_TIMEOUT_MS);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (status, signal) => {
			clearTimeout(timeout);
			resolve({ status, signal, stdout, stderr });
		});
		child.stdin.end(input);
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
			timeout: HOOK_CLI_TEST_TIMEOUT_MS,
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
