#!/usr/bin/env bun
// Live macOS QA for the foreground-control grant (#9651, #10443): the real senpi in `--mode rpc`, the built omo
// plugin, the omo mock provider, and the REAL `senpi-desktop-engine` on its macOS backend (no fake backend).
// It raises a dialog window this driver opens, because `win.raise()` always needs the grant, then checks that
// the grant really ends. Each scenario is one senpi session with two prompts:
//
//   approved-then-ended  prompt 1 acquires (the client approves) and raises: admitted. After agent_end the engine
//                        audits control.revoke, and prompt 2 raises without acquiring: refused ControlRequired.
//   interrupted          prompt 1 acquires (approved), then waits; the client sends `abort` once the engine has
//                        audited control.grant. Prompt 2 raises: refused ControlRequired.
//   declined             prompt 1 acquires (the client declines) and raises: refused ControlRequired, no grant.
//
// macOS charges Accessibility to the app that launched the engine, and the engine refuses to run as its own
// responsible process: start this from Terminal (or the app holding the grants), never from a disclaimed spawn.
//
// Usage: SENPI_BIN=<senpi> bun computer-control-live-macos.mjs --engine <path> [--evidence-dir <dir>] [--only a,b]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	auditActions,
	jsonLines,
	scenarios,
	TARGET_TITLE,
	toolResults,
} from "./computer-control-live-macos-scenarios.mjs";
import { createSandbox, seedSandbox } from "./drive.mjs";
import { isolatedChildEnv } from "./sandbox-child-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..", "..");
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts");
const TURN_TIMEOUT_MS = 120_000;

function argValue(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

const senpiBin = process.env.SENPI_BIN?.trim();
const enginePath = resolve(
	argValue("--engine") ??
		join(repoRoot, "target", "release", "senpi-desktop-engine"),
);
const evidenceDir = argValue("--evidence-dir");
const only = argValue("--only")?.split(",");

const scrubbedEnv = () =>
	Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !/^(OMO|SENPI|PI)_/.test(key),
		),
	);

// The target is a dialog owned by an osascript child of this driver: no AppleEvent reaches another app, and
// closing it is killing that child.
let target;
function openTarget() {
	target = spawn(
		"osascript",
		[
			"-e",
			`display dialog "computer-control QA target" with title "${TARGET_TITLE}" giving up after 900`,
		],
		{
			stdio: "ignore",
		},
	);
}

function closeTarget() {
	target?.kill("SIGTERM");
}

// One senpi rpc session; `steps` is the mock provider's whole script across both prompts.
function startSession(steps) {
	const sandbox = createSandbox();
	seedSandbox(sandbox);
	mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true });
	writeFileSync(
		join(sandbox.cwd, ".omo", "omo.jsonc"),
		JSON.stringify({ computer: { engine_path: enginePath } }),
	);
	writeFileSync(
		join(sandbox.cwd, "mock-script.json"),
		`${JSON.stringify({ steps }, null, 2)}\n`,
	);
	const child = spawn(
		senpiBin,
		[
			"-e",
			mockProviderEntry,
			"--mode",
			"rpc",
			"--provider",
			"omo-mock",
			"--model",
			"mock-1",
			"--permission-preset",
			"ask",
			"--permission",
			"computer:read=allow",
			"--permission",
			"computer:exec=allow",
		],
		{
			cwd: sandbox.cwd,
			env: {
				...isolatedChildEnv(scrubbedEnv(), sandbox.agentDir),
				OMO_CODING_AGENT_DIR: sandbox.agentDir,
				SENPI_CODING_AGENT_DIR: sandbox.agentDir,
				PI_CODING_AGENT_DIR: sandbox.agentDir,
				HOME: sandbox.homeDir,
				XDG_CONFIG_HOME: sandbox.xdgConfigHome,
				XDG_DATA_HOME: sandbox.xdgDataHome,
				XDG_CACHE_HOME: sandbox.xdgCacheHome,
				PI_OFFLINE: "1",
				OMO_SENPI_QA: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
		},
	);
	const events = [];
	const waiters = [];
	let stdout = "";
	let stderr = "";
	let buffered = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		buffered += chunk;
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		for (const event of jsonLines(lines.join("\n"))) {
			events.push(event);
			for (const waiter of [...waiters]) waiter();
		}
	});
	const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
	// Resolves when `predicate` holds for the recorded events or the audit; checked on every event and every 200 ms.
	const until = (description, predicate) =>
		new Promise((resolvePromise, reject) => {
			const check = () => {
				if (!predicate()) return false;
				cleanup();
				resolvePromise();
				return true;
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error(`timed out waiting for ${description}`));
			}, TURN_TIMEOUT_MS);
			const poll = setInterval(check, 200);
			const cleanup = () => {
				clearTimeout(timer);
				clearInterval(poll);
				const index = waiters.indexOf(check);
				if (index !== -1) waiters.splice(index, 1);
			};
			waiters.push(check);
			check();
		});
	const agentEnds = () =>
		events.filter((event) => event.type === "agent_end").length;
	const close = () => {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {}
		const outcome = {
			audits: auditActions(sandbox.root),
			results: toolResults(sandbox.agentDir),
			confirms: events
				.filter(
					(event) =>
						event.type === "extension_ui_request" && event.method === "confirm",
				)
				.map((event) => event.title),
			stdout,
			stderr,
		};
		rmSync(sandbox.root, { recursive: true, force: true });
		return outcome;
	};
	return { sandbox, events, send, until, agentEnds, close };
}

if (process.platform !== "darwin") {
	console.log(
		JSON.stringify({
			verdict: "SKIP",
			reason: "macOS only; this is not a pass",
		}),
	);
	process.exit(1);
}
if (!senpiBin || !existsSync(enginePath)) {
	console.log(
		JSON.stringify({
			verdict: "FAIL",
			reason: !senpiBin ? "SENPI_BIN is unset" : `no engine at ${enginePath}`,
		}),
	);
	process.exit(1);
}
if (evidenceDir !== undefined) mkdirSync(evidenceDir, { recursive: true });

// The real credentials and settings must not change: the driver only ever touches its sandbox.
const protectedFiles = [
	join(homedir(), ".senpi", "agent", "auth.json"),
	join(homedir(), ".omo", "agent", "auth.json"),
	join(homedir(), ".omo", "agent", "settings.json"),
];
const digest = (path) =>
	existsSync(path)
		? createHash("sha256").update(readFileSync(path)).digest("hex")
		: "absent";
const before = protectedFiles.map(digest);
const report = [];
openTarget();
try {
	for (const [name, scenario] of Object.entries(scenarios)) {
		if (only !== undefined && !only.includes(name)) continue;
		const session = startSession(scenario.steps);
		let error;
		try {
			await scenario.drive(session);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
		const outcome = session.close();
		const checks = scenario
			.verify(outcome)
			.map(([label, ok]) => ({ label, ok }));
		const pass = error === undefined && checks.every((check) => check.ok);
		report.push({ name, pass, error, checks });
		if (evidenceDir !== undefined) {
			writeFileSync(
				join(evidenceDir, `${name}.json`),
				`${JSON.stringify({ name, pass, error, checks, audits: outcome.audits, results: outcome.results, stdout: outcome.stdout.slice(-20_000), stderr: outcome.stderr.slice(-4000) }, null, 2)}\n`,
			);
		}
	}
} finally {
	closeTarget();
}
const realSenpiUntouched = protectedFiles.every(
	(path, index) => digest(path) === before[index],
);
const verdict =
	report.length > 0 && report.every((entry) => entry.pass) && realSenpiUntouched
		? "PASS"
		: "FAIL";
console.log(
	JSON.stringify(
		{ verdict, engine: enginePath, realSenpiUntouched, protectedFiles, report },
		null,
		2,
	),
);
process.exit(verdict === "PASS" ? 0 : 1);
