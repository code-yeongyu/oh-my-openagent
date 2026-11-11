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
//   off-space-capture    full access: resolves the dialog window, switches one Space right (ctrl+right, so a second
//                        Space must exist), screenshots the now off-Space window, switches back. Expects a frame
//                        (SkyLight); with --disable-skylight it expects CaptureUnavailable reason off-space.
//   two-window-typing    macOS key priming (plan row 16): opens two TextEdit documents in the background, A key, then
//                        types into B three times with macos_key_priming on. Passes when A's text is unchanged, B is
//                        its original plus every typed piece, and A is TextEdit's key window again once all three
//                        calls ended (checked once, after the last one). Its variant does the same with A's text
//                        area focused first (focus only, no selection in A). Priming runs only in a
//                        reportMode:"object" session, so until omo opens those (plan row 36) this FAILS with
//                        BackgroundUnavailable; that is not a priming failure.
//
// macOS charges Accessibility to the app that launched the engine, and the engine refuses to run as its own
// responsible process: start this from Terminal (or the app holding the grants), never from a disclaimed spawn.
//
// Usage: SENPI_BIN=<senpi> bun computer-control-live-macos.mjs --engine <path> [--evidence-dir <dir>] [--only a,b]
//        [--disable-skylight]
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
import { desktopScenarios } from "./computer-control-live-macos-desktop.mjs";
import { createSandbox, seedSandbox } from "./drive.mjs";
import { isolatedChildEnv } from "./sandbox-child-env.mjs";
import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs";

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
const skylightDisabled = process.argv.includes("--disable-skylight");

const offSpaceRun = `
const w = await desktop.window({ title: ${JSON.stringify(TARGET_TITLE)} });
await desktop.press("ctrl+right");
await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
let shot, error;
try { shot = await w.screenshot({ silent: true }); } catch (caught) { error = String(caught?.code ?? "") + " " + String(caught?.message ?? caught); }
await desktop.press("ctrl+left");
return JSON.stringify({ offSpace: { width: shot?.width ?? 0, height: shot?.height ?? 0, error: error ?? null } });
`;

const offSpaceScenario = {
	"off-space-capture": {
		preset: "full-access",
		env: skylightDisabled ? { SENPI_DESKTOP_DISABLE_SKYLIGHT: "1" } : {},
		steps: [
			{ type: "tool_call", name: "computer", arguments: { action: "run", code: offSpaceRun } },
			{ type: "text", text: "done" },
		],
		drive: async (session) => {
			session.send({ type: "prompt", message: "control QA: capture the dialog from another Space" });
			await session.until("agent_end", () => session.agentEnds() >= 1);
		},
		verify: ({ results }) => {
			const raw = results[0] ?? "";
			const match = /\{"offSpace":\{[^}]*\}\}/.exec(raw.replaceAll('\\"', '"'));
			const outcome = match === null ? undefined : JSON.parse(match[0]).offSpace;
			return skylightDisabled
				? [
						["the run reported its off-Space outcome", outcome !== undefined],
						[
							"without SkyLight the off-Space window is CaptureUnavailable off-space",
							String(outcome?.error).includes("CaptureUnavailable") || String(outcome?.error).includes("another Space"),
						],
					]
				: [
						["the run reported its off-Space outcome", outcome !== undefined],
						["the off-Space window was captured", outcome?.error === null && outcome.width > 0 && outcome.height > 0],
					];
		},
	},
};

// Two TextEdit documents, read and closed through TextEdit's own scripting (an oracle outside the engine).
const textEdit = (script) =>
	new Promise((resolveRun) => {
		const child = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.on("exit", () => resolveRun(out.replace(/\n$/, "")));
	});
const sha = (text) => createHash("sha256").update(text).digest("hex");
const twoWindow = { dir: "", a: "", b: "" };
const PIECES = ["-qa1", "-qa2", "-qa3"];

async function openDocuments(variant) {
	twoWindow.dir = join(homedir(), "Library", "Caches", `omo-two-window-qa-${process.pid}-${variant}`);
	mkdirSync(twoWindow.dir, { recursive: true });
	const [a, b] = ["A", "B"].map((name) => `qa-${variant}-${name}.txt`);
	Object.assign(twoWindow, { a, b });
	writeFileSync(join(twoWindow.dir, a), "alpha original\n");
	writeFileSync(join(twoWindow.dir, b), "bravo original\n");
	// `-g` keeps TextEdit in the background; A opens last, so it is the key document.
	for (const name of [b, a]) {
		spawn("open", ["-g", "-a", "TextEdit", join(twoWindow.dir, name)]);
		await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
	}
	return {
		a: await textEdit(`tell application "TextEdit" to get text of document "${a}"`),
		b: await textEdit(`tell application "TextEdit" to get text of document "${b}"`),
		key: await textEdit('tell application "TextEdit" to get name of window 1'),
	};
}

async function closeDocuments() {
	if (twoWindow.dir === "") return;
	for (const name of [twoWindow.a, twoWindow.b]) {
		await textEdit(`tell application "TextEdit" to close (every document whose name is "${name}") saving no`);
	}
	rmSync(twoWindow.dir, { recursive: true, force: true });
	twoWindow.dir = "";
}

const twoWindowRun = (b, a, focusA) => `
const target = await desktop.window({ title: ${JSON.stringify(b)} });
${focusA ? `const other = await desktop.window({ title: ${JSON.stringify(a)} }); const [field] = await other.find({ role: "textarea" }); if (field !== undefined) await field.focus();` : ""}
const calls = [];
for (const piece of ${JSON.stringify(PIECES)}) {
  try { await target.type(piece); calls.push({ piece, ok: true }); }
  catch (caught) { calls.push({ piece, ok: false, error: String(caught?.code ?? "") + " " + String(caught?.message ?? caught) }); }
}
return JSON.stringify({ twoWindow: calls });
`;

const twoWindowScenario = (variant, focusA) => ({
	preset: "full-access",
	computer: { macos_key_priming: "on" },
	setup: () => openDocuments(variant),
	teardown: closeDocuments,
	steps: () => [
		{ type: "tool_call", name: "computer", arguments: { action: "run", code: twoWindowRun(twoWindow.b, twoWindow.a, focusA) } },
		{ type: "text", text: "done" },
	],
	drive: async (session) => {
		session.send({ type: "prompt", message: "control QA: type into the background document B" });
		await session.until("agent_end", () => session.agentEnds() >= 1);
		Object.assign(session.observed, {
			a: await textEdit(`tell application "TextEdit" to get text of document "${twoWindow.a}"`),
			b: await textEdit(`tell application "TextEdit" to get text of document "${twoWindow.b}"`),
			key: await textEdit('tell application "TextEdit" to get name of window 1'),
		});
	},
	verify: ({ results, before, observed }) => {
		const raw = (results[0] ?? "").replaceAll('\\"', '"');
		const match = /\{"twoWindow":\[.*?\]\}/s.exec(raw);
		const calls = match === null ? undefined : JSON.parse(match[0]).twoWindow;
		return [
			["A was the key document before typing", before?.key === twoWindow.a],
			["every background type call succeeded", calls?.length === PIECES.length && calls.every((call) => call.ok)],
			[`A unchanged (sha256 ${sha(before?.a ?? "")} -> ${sha(observed.a ?? "")})`, observed.a === before?.a],
			// The typed text lands at B's insertion point (the document start after `open`), as one run.
			[
				`B is its original plus the typed text (sha256 ${sha(observed.b ?? "")})`,
				before !== undefined && observed.b?.includes(PIECES.join("")) === true && observed.b.replace(PIECES.join(""), "") === before.b,
			],
			["A is the key document again after hand-back", observed.key === twoWindow.a],
		];
	},
});

const twoWindowScenarios = {
	"two-window-typing": twoWindowScenario("plain", false),
	"two-window-typing-focused-other": twoWindowScenario("focused", true),
};

const scrubbedEnv = () =>
	Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !/^(OMO|SENPI|PI)_/.test(key),
		),
	);

// The target is a dialog owned by an osascript child of this driver: no AppleEvent reaches another app, and
// closing it is killing that child. Its reply (`button returned:OK`) is how a desktop click is observed.
let target;
const targetState = { open: false, reply: "" };
function openTarget() {
	targetState.open = true;
	targetState.reply = "";
	target = spawn(
		"osascript",
		[
			"-e",
			`display dialog "computer-control QA target" with title "${TARGET_TITLE}" giving up after 900`,
		],
		{
			stdio: ["ignore", "pipe", "ignore"],
		},
	);
	const child = target;
	child.stdout.on("data", (chunk) => {
		if (child === target) targetState.reply += chunk;
	});
	child.on("exit", () => {
		if (child === target) targetState.open = false;
	});
}

function closeTarget() {
	target?.kill("SIGTERM");
}

async function dialogClosed(timeoutMs) {
	const started = Date.now();
	while (targetState.open && Date.now() - started < timeoutMs) {
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}
}

// One senpi rpc session; `steps` is the mock provider's whole script across both prompts.
function startSession(steps, { preset = "ask", print, env: scenarioEnv = {}, computer = {} } = {}) {
	const sandbox = createSandbox();
	seedSandbox(sandbox);
	mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true });
	writeFileSync(
		join(sandbox.cwd, ".omo", "omo.jsonc"),
		JSON.stringify({ computer: { engine_path: enginePath, ...computer } }),
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
			...(print === undefined ? ["--mode", "rpc"] : ["--mode", "json", "--print", print]),
			"--provider",
			"omo-mock",
			"--model",
			"mock-1",
			"--permission-preset",
			preset,
			"--permission",
			"computer:read=allow",
			"--permission",
			"computer:exec=allow",
		],
		{
			cwd: sandbox.cwd,
			env: withTelemetryOptOut({
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
				...scenarioEnv,
			}),
			stdio: [print === undefined ? "pipe" : "ignore", "pipe", "pipe"],
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
			target: { ...targetState },
		};
		rmSync(sandbox.root, { recursive: true, force: true });
		return outcome;
	};
	const exited = new Promise((resolveExit) => child.on("exit", resolveExit));
	return { sandbox, events, send, until, agentEnds, close, exited, observed: {} };
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
	for (const [name, scenario] of Object.entries({ ...scenarios, ...desktopScenarios, ...offSpaceScenario, ...twoWindowScenarios })) {
		if (only !== undefined && !only.includes(name)) continue;
		const before = await scenario.setup?.();
		let steps = scenario.steps;
		if (typeof steps === "function") {
			// Every desktop scenario gets a fresh dialog: an admitted click dismisses it.
			closeTarget();
			openTarget();
			steps = steps();
		}
		const session = startSession(steps, scenario);
		let error;
		try {
			if (scenario.print === undefined) await scenario.drive(session);
			else await session.exited;
			// An admitted click dismisses the dialog; give osascript a moment to report it. A refused click
			// leaves it open, which the bounded wait simply outlasts.
			if (typeof scenario.steps === "function") await dialogClosed(3000);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
		const outcome = { ...session.close(), before, observed: session.observed };
		await scenario.teardown?.();
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
