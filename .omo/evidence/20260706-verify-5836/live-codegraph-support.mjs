import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

export const repoRoot = process.cwd();
export const evidenceDir = resolve(".omo/evidence/20260706-verify-5836");
export const mockScript = join(repoRoot, ".agents/skills/codex-qa/scripts/lib/mock-model.mjs");
export const appServerClient = join(repoRoot, ".agents/skills/codex-qa/scripts/lib/app-server-client.mjs");
export const installer = join(repoRoot, "packages/omo-codex/scripts/install-local.mjs");
export const mockLog = join(evidenceDir, "mock-model.log");
export const fakeLog = join(evidenceDir, "fake-codegraph-invocations.jsonl");
export const installLog = join(evidenceDir, "install-local-live-qa.txt");
export const directProbePath = join(evidenceDir, "direct-session-start-probes.mjs");
export const serveProbePath = join(evidenceDir, "serve-env-probe.mjs");
export const workerProbePath = join(evidenceDir, "worker-normal-probe.mjs");

mkdirSync(evidenceDir, { recursive: true });

export function shaText(text) {
	return createHash("sha256").update(text).digest("hex");
}

export function hashFile(path) {
	if (!existsSync(path)) return "ABSENT";
	const result = spawnSync("shasum", ["-a", "256", path], { encoding: "utf8", maxBuffer: 1024 * 1024 });
	if (result.status !== 0) throw new Error(`shasum failed for ${path}: ${result.stderr}`);
	return result.stdout.trim().split(/\s+/)[0] ?? "EMPTY_SHASUM";
}

export function hashTree(root) {
	if (!existsSync(root)) return "ABSENT";
	const rows = [];
	function walk(path) {
		const stat = lstatSync(path);
		const rel = relative(root, path) || ".";
		if (stat.isDirectory()) {
			rows.push(`dir ${rel} ${stat.mode & 0o777}`);
			for (const entry of readdirSync(path).sort()) walk(join(path, entry));
			return;
		}
		if (stat.isSymbolicLink()) {
			rows.push(`link ${rel} ${readlinkSync(path)}`);
			return;
		}
		if (stat.isFile()) {
			rows.push(`file ${rel} ${stat.mode & 0o777} ${stat.size} ${hashFile(path)}`);
			return;
		}
		rows.push(`other ${rel} ${stat.mode & 0o777}`);
	}
	walk(root);
	return shaText(`${rows.join("\n")}\n`);
}

export function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
		env: options.env ?? process.env,
		maxBuffer: 20 * 1024 * 1024,
	});
	if (options.outputPath) {
		writeFileSync(
			options.outputPath,
			`$ ${[command, ...args].join(" ")}\nEXIT_CODE=${result.status ?? "null"}\n\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
		);
	}
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
	return result;
}

export function waitForMockPort(proc) {
	for (let i = 0; i < 200; i += 1) {
		const text = existsSync(mockLog) ? readFileSync(mockLog, "utf8") : "";
		const match = text.match(/MOCK_LISTENING\s+(\d+)/);
		if (match) return match[1];
		if (proc.exitCode !== null) throw new Error(`mock model exited early: ${text}`);
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	}
	throw new Error("mock model did not report a port");
}

export function readFakeLog() {
	return readFileSync(fakeLog, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

export function sourceMetadataRows(projectsDir) {
	if (!existsSync(projectsDir)) return [];
	const rows = [];
	for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const metadataPath = join(projectsDir, entry.name, "source.json");
		if (existsSync(metadataPath)) rows.push({ name: entry.name, metadata: JSON.parse(readFileSync(metadataPath, "utf8")) });
	}
	return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export function assert(condition, message) {
	if (!condition) throw new Error(message);
}

export function runAppServerScenario(name, cwd, mockPort, env) {
	const outputPath = join(evidenceDir, `app-server-${name}.json`);
	const result = run(process.execPath, [appServerClient], {
		env: {
			...env,
			DEADLINE_MS: "90000",
			EXPECT_HOOK: "sessionStart,userPromptSubmit",
			MOCK_PORT: mockPort,
			PROMPT: `ulw: codegraph qa ${name}`,
			QA_CWD: cwd,
		},
		outputPath,
	});
	const parsed = JSON.parse(result.stdout);
	writeFileSync(outputPath, `${JSON.stringify(parsed, null, 2)}\n`);
	assert(parsed.ok === true, `${name} app-server scenario failed`);
	return parsed;
}

export function waitForFakeInvocation(predicate, label) {
	for (let i = 0; i < 100; i += 1) {
		const rows = readFakeLog();
		if (rows.some(predicate)) return rows;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	}
	throw new Error(`timed out waiting for fake CodeGraph invocation: ${label}`);
}

export function writeFakeCodegraph(fakeBin) {
	writeFileSync(
		fakeBin,
		`#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const logPath = ${JSON.stringify(fakeLog)};
const row = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    CODEGRAPH_INSTALL_DIR: process.env.CODEGRAPH_INSTALL_DIR,
    CODEGRAPH_NO_DAEMON: process.env.CODEGRAPH_NO_DAEMON,
    CODEGRAPH_NO_DOWNLOAD: process.env.CODEGRAPH_NO_DOWNLOAD,
    CODEGRAPH_TELEMETRY: process.env.CODEGRAPH_TELEMETRY,
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    HOME: process.env.HOME,
    OMO_CODEGRAPH_SESSION_START_CWD: process.env.OMO_CODEGRAPH_SESSION_START_CWD,
  },
  pid: process.pid,
  ppid: process.ppid,
  timestamp: new Date().toISOString(),
};
appendFileSync(logPath, JSON.stringify(row) + "\\n");
if (process.argv.includes("status")) {
  console.log(JSON.stringify({ initialized: false }));
  process.exit(0);
}
console.log("fake-codegraph-ok");
process.exit(0);
`,
	);
	chmodSync(fakeBin, 0o755);
}

export function writeDirectProbe() {
	writeFileSync(
		directProbePath,
		`import { Readable } from "node:stream";
import { executeCodegraphSessionStartHook } from "../../../packages/omo-codex/plugin/components/codegraph/src/hook.ts";
const result = await executeCodegraphSessionStartHook({
  config: { codegraph: { enabled: true }, sources: [], warnings: [] },
  cwd: process.env.QA_TARGET_CWD,
  env: { ...process.env, HOME: process.env.QA_ISOLATED_HOME },
  stdin: Readable.from(["{}"]),
  stdout: { write: () => { throw new Error("excluded hook must not write SessionStart output"); } },
  spawnWorker: () => { throw new Error("excluded hook must not spawn worker"); },
  statusProbe: () => { throw new Error("excluded hook must not probe status"); },
});
console.log(JSON.stringify(result, null, 2));
`,
	);
}

export function writeServeProbe() {
	writeFileSync(
		serveProbePath,
		`import { Readable, Writable } from "node:stream";
import { runCodegraphServe } from "../../../packages/omo-codex/plugin/components/codegraph/src/serve.ts";
const captured = [];
await runCodegraphServe({
  cwd: process.env.QA_NORMAL_CWD,
  env: { ...process.env, HOME: process.env.QA_ISOLATED_HOME, OMO_CODEGRAPH_BIN: process.env.QA_FAKE_CODEGRAPH_BIN },
  homeDir: process.env.QA_ISOLATED_HOME,
  config: { codegraph: { enabled: true }, sources: [], warnings: [] },
  stdin: Readable.from([]),
  stdout: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  stderr: { write: () => {} },
  resolve: () => ({ argsPrefix: [], command: process.env.QA_FAKE_CODEGRAPH_BIN, exists: true, source: "env" }),
  runProcess: async (command, args, options) => {
    captured.push({ args, command, cwd: options.cwd, env: {
      CODEGRAPH_INSTALL_DIR: options.env.CODEGRAPH_INSTALL_DIR,
      CODEGRAPH_NO_DAEMON: options.env.CODEGRAPH_NO_DAEMON,
      CODEGRAPH_NO_DOWNLOAD: options.env.CODEGRAPH_NO_DOWNLOAD,
      CODEGRAPH_TELEMETRY: options.env.CODEGRAPH_TELEMETRY,
      DO_NOT_TRACK: options.env.DO_NOT_TRACK,
      HOME: options.env.HOME,
    } });
    return 0;
  },
});
console.log(JSON.stringify(captured, null, 2));
`,
	);
}

export function writeWorkerProbe() {
	writeFileSync(
		workerProbePath,
		`import { runCodegraphSessionStartWorker } from "../../../packages/omo-codex/plugin/components/codegraph/src/hook.ts";
const result = await runCodegraphSessionStartWorker({
  config: { codegraph: { auto_provision: false, enabled: true }, sources: [], warnings: [] },
  cwd: process.env.QA_NORMAL_CWD,
  env: { ...process.env, HOME: process.env.QA_ISOLATED_HOME, OMO_CODEGRAPH_BIN: process.env.QA_FAKE_CODEGRAPH_BIN },
});
console.log(JSON.stringify(result, null, 2));
`,
	);
}

export function bunBin(realHome = process.env.HOME ?? homedir()) {
	return process.env.PATH?.includes(".bun") ? "bun" : join(realHome, ".bun", "bin", "bun");
}
