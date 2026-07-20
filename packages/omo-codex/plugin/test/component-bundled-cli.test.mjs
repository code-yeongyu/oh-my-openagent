import assert from "node:assert/strict";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import { readAggregateHookManifests, readJson, root } from "./aggregate-plugin-fixture.mjs";
import { componentHookContractCases } from "./component-hook-contract-cases.mjs";

const HOOK_EVENTS_BY_COMPONENT = {
	"comment-checker": "post-tool-use",
	"git-bash": "pre-tool-use",
	"lazycodex-executor-verify": "subagent-stop",
	lsp: "post-compact",
	rules: "session-start",
	"start-work-continuation": "stop",
	telemetry: "session-start",
	teammode: "post-tool-use",
	ultrawork: "user-prompt-submit",
	"ulw-loop": "pre-tool-use",
};
const MCP_ONLY_COMPONENTS = new Set(["codegraph"]);
const HOOK_CLI_TEST_TIMEOUT_MS = 45_000;
const DAEMON_EXIT_TIMEOUT_MS = 5_000;

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

test("#given built MCP-only CodeGraph entries #when executed with a fake binary #then each entry is self-contained", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-mcp-wrapper-"));
	try {
		const fakeBinaryPath = join(tempRoot, "codegraph-fake.cjs");
		const invocationLogPath = join(tempRoot, "invocations.log");
		writeFileSync(
			fakeBinaryPath,
			[
				"#!/usr/bin/env node",
				"const fs = require('node:fs');",
				"fs.appendFileSync(process.env.CODEGRAPH_FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
				"",
			].join("\n"),
		);
		chmodSync(fakeBinaryPath, 0o755);

		const serveResult = runCodegraphMcpEntry("serve.js", tempRoot, fakeBinaryPath, invocationLogPath);
		const cliResult = runCodegraphMcpEntry("cli.js", tempRoot, fakeBinaryPath, invocationLogPath);

		assert.equal(serveResult.status, 0, `serve.js stderr: ${serveResult.stderr}`);
		assert.equal(cliResult.status, 0, `cli.js stderr: ${cliResult.stderr}`);
		assert.equal(serveResult.stderr, "");
		assert.equal(cliResult.stderr, "");
		assert.deepEqual(readFileSync(invocationLogPath, "utf8").trim().split("\n"), [
			'["serve","--mcp"]',
			'["serve","--mcp"]',
		]);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
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

test("#given bundled LSP hook CLI in installed layout #when diagnostics run #then it spawns sibling daemon target", async () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-lsp-installed-"));
	try {
		const lspDist = join(tempRoot, "components", "lsp", "dist");
		const daemonDist = join(tempRoot, "components", "lsp-daemon", "dist");
		const daemonDir = join(tempRoot, "daemon");
		mkdirSync(lspDist, { recursive: true });
		mkdirSync(daemonDist, { recursive: true });
		mkdirSync(join(tempRoot, "src"), { recursive: true });
		writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(lspDist, "cli.js"), readFileSync(componentCliPath("lsp"), "utf8"));
		cpSync(join(root, "..", "..", "lsp-daemon", "dist"), daemonDist, { recursive: true });
		const editedFile = join(tempRoot, "src", "broken.ts");
		const scenarioPath = join(tempRoot, "scenario.json");
		const eventsPath = join(tempRoot, "lsp-events.jsonl");
		const codexHome = join(tempRoot, "codex-home");
		mkdirSync(codexHome, { recursive: true });
		writeFileSync(editedFile, "const value: string = 1;\n");
		writeFileSync(eventsPath, "");
		writeFileSync(
			scenarioPath,
			JSON.stringify({
				publishDiagnostics: [
					{
						trigger: "didOpen",
						version: 1,
						diagnostics: [
							{
								range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
								severity: 1,
								code: "fake",
								source: "fake",
								message: "Missing fake symbol.",
							},
						],
					},
				],
				diagnosticResponses: [
					{
						report: {
							items: [
								{
									range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
									severity: 1,
									code: "fake",
									source: "fake",
									message: "Missing fake symbol.",
								},
							],
						},
					},
				],
			}),
		);
		writeFileSync(
			join(codexHome, "lsp-client.json"),
			JSON.stringify({
				lsp: {
					typescript: {
						command: [
							process.execPath,
							join(root, "..", "..", "lsp-core", "src", "lsp", "fixtures", "workspace-edit-server.mjs"),
							scenarioPath,
							eventsPath,
						],
						extensions: [".ts"],
					},
				},
			}),
		);

		const result = spawnSync(process.execPath, [join(lspDist, "cli.js"), "hook", "post-tool-use"], {
			cwd: tempRoot,
			encoding: "utf8",
			env: hookEnv(tempRoot, {
				CODEX_HOME: codexHome,
				OMO_LSP_DAEMON_DIR: daemonDir,
				NODE_PATH: "",
			}),
			input: JSON.stringify({
				session_id: "bundled-lsp-hook",
				tool_name: "Edit",
				tool_input: { file_path: editedFile },
				tool_response: { ok: true },
			}),
			timeout: HOOK_CLI_TEST_TIMEOUT_MS,
		});

		const failureContext = `stdout: ${result.stdout}\nstderr: ${result.stderr}`;
		assert.equal(result.status, 0, failureContext);
		assert.equal(result.stderr, "", failureContext);
		assert.notEqual(result.stdout, "", failureContext);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.decision, "block");
		assert.match(parsed.reason, /Missing fake symbol\./);
		assert.match(readFileSync(eventsPath, "utf8"), /textDocument\/publishDiagnostics/);
		assert.equal(existsSync(join(daemonDir, `v${JSON.parse(readFileSync(join(daemonDist, "package.json"), "utf8")).version}`, "daemon.log")), true);
	} finally {
		await stopTestDaemons(join(tempRoot, "daemon"));
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
	const manifests = await readAggregateHookManifests();
	const commands = manifests.flatMap(({ hooks }) => collectHookCommands(hooks.hooks));
	const components = await workspaceComponents();

	// when
	const missingContracts = components.filter(
		(component) =>
			!MCP_ONLY_COMPONENTS.has(component) &&
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
		.filter((component) => !MCP_ONLY_COMPONENTS.has(component))
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

function runCodegraphMcpEntry(entryName, tempRoot, fakeBinaryPath, invocationLogPath) {
	return spawnSync(process.execPath, [join(root, "components", "codegraph", "dist", entryName)], {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			CODEGRAPH_FAKE_LOG: invocationLogPath,
			HOME: tempRoot,
			OMO_CODEGRAPH_BIN: fakeBinaryPath,
		},
		timeout: HOOK_CLI_TEST_TIMEOUT_MS,
	});
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

function writeFakeLspDaemonCli(path) {
	writeFileSync(
		path,
		[
			"#!/usr/bin/env node",
			'import { createHash } from "node:crypto";',
			'import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";',
			'import { tmpdir } from "node:os";',
			'import { dirname, join } from "node:path";',
			'import { createServer } from "node:net";',
			"",
			"appendFileSync(process.env.FAKE_LSP_DAEMON_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);",
			"const baseDir = process.env.OMO_LSP_DAEMON_DIR;",
			'const versionDirName = readdirSync(baseDir).find((entry) => entry.startsWith("v")) ?? "v0";',
			"const version = versionDirName.slice(1);",
			"const dir = join(baseDir, versionDirName);",
			'const naturalSocket = join(dir, "daemon.sock");',
			'const digest = createHash("sha256").update(dir).digest("hex").slice(0, 16);',
			"const socketPath = process.platform === \"win32\"",
			"\t? `\\\\\\\\.\\\\pipe\\\\omo-lsp-${version}-${digest}`",
			"\t: naturalSocket.length < 100 ? naturalSocket : join(tmpdir(), `omo-lsp-${version}-${digest}.sock`);",
			"if (process.platform !== \"win32\") {",
			"\tmkdirSync(dirname(socketPath), { recursive: true });",
			"\ttry { unlinkSync(socketPath); } catch {}",
			"}",
			"const server = createServer((socket) => {",
			'\tlet raw = "";',
			'\tsocket.setEncoding("utf8");',
			'\tsocket.on("data", (chunk) => {',
			"\t\traw += chunk;",
			'\t\tif (!raw.includes("\\n")) return;',
			"\t\tconst request = JSON.parse(raw.trim());",
			"\t\tconst response = {",
			'\t\t\tjsonrpc: "2.0",',
			"\t\t\tid: request.id,",
			"\t\t\tresult: {",
			'\t\t\t\tcontent: [{ type: "text", text: "error[fake] (1) at 1:1: Missing fake symbol." }],',
			"\t\t\t},",
			"\t\t};",
			'\t\tsocket.end(`${JSON.stringify(response)}\\n`);',
			"\t\tserver.close(() => process.exit(0));",
			"\t});",
			"});",
			"server.listen(socketPath);",
			"setTimeout(() => process.exit(1), 10000).unref();",
			"",
		].join("\n"),
	);
}

async function stopTestDaemons(daemonRoot) {
	if (!existsSync(daemonRoot)) return;
	for (const versionDir of readdirSync(daemonRoot)) {
		const pidPath = join(daemonRoot, versionDir, "daemon.pid");
		if (!existsSync(pidPath)) continue;
		const pid = Number(readFileSync(pidPath, "utf8").trim());
		if (!Number.isInteger(pid) || pid <= 0) continue;
		if (process.platform === "win32") {
			const result = spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
				encoding: "utf8",
				windowsHide: true,
			});
			if (result.error) throw result.error;
			if (result.status !== 0 && processIsRunning(pid)) {
				throw new Error(
					`taskkill failed for test daemon ${pid}: exit=${result.status} stderr=${result.stderr.trim()}`,
				);
			}
		} else {
			try {
				process.kill(pid, "SIGTERM");
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ESRCH") continue;
				throw error;
			}
		}
		await waitForProcessExit(pid);
	}
}

async function waitForProcessExit(pid) {
	const deadline = Date.now() + DAEMON_EXIT_TIMEOUT_MS;
	while (processIsRunning(pid)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for test daemon ${pid} to exit`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

function processIsRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
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
