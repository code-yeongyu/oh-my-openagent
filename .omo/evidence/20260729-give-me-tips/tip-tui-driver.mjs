#!/usr/bin/env node
// Unified TUI proof driver for the give-me-tips run (ultrawork C1/C2-surface + C6).
// Modes:
//   senpi-startup — boot senpi FROM SOURCE (senpi-wt, tsx) in a fresh sandbox; the startup
//                   header shows the first unseen tip; assert the give-me-tips pointer renders.
//   omo-fallback  — boot the INSTALLED senpi with the omo-wt plugin + refusal mock provider in a
//                   seeded fallback-architect sandbox; send a prompt; assert the visible
//                   fallback tip (fallback model id + give-me-tips) renders.
// Evidence per mode: <out>/<mode>.ans (raw), <out>/<mode>.txt (plain), <out>/<mode>.grid.json,
// <out>/<mode>.html (xterm triplet), <out>/<mode>-receipt.json (cleanup + auth-unchanged).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const SENPI_WT = "/Users/yeongyu/local-workspaces/senpi-wt-give-me-tips";
const OMO_WT = "/Users/yeongyu/local-workspaces/omo-wt-give-me-tips";
const SENPI_BIN = process.env.SENPI_BIN?.trim() || "/Users/yeongyu/.bun/bin/senpi";
const MOCK_PROVIDER = join(OMO_WT, "packages/omo-senpi/scripts/qa/fallback-architect-mock-provider.ts");
const XTERM_RENDER = join(SENPI_WT, "scripts/qa/xterm-render.mjs");
const REAL_AUTH = join(homedir(), ".senpi", "agent", "auth.json");
const COLS = 220;
const ROWS = 50;

function parseArgs(argv) {
	const args = { timeoutMs: 120_000 };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--mode") args.mode = argv[++i];
		else if (a === "--out") args.out = argv[++i];
		else if (a === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
		else throw new Error(`unknown argument: ${a}`);
	}
	if (!args.mode || !["senpi-startup", "omo-fallback"].includes(args.mode)) throw new Error("--mode senpi-startup|omo-fallback required");
	if (!args.out) throw new Error("--out <dir> required");
	return args;
}

const sha256OrNull = (path) => {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch {
		return null;
	}
};

const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8", timeout: 15_000 });
const stripAnsi = (s) => s.replace(/\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[=>]/g, "");

function capture(session, { escapes = false } = {}) {
	const args = ["capture-pane", "-t", session, "-p"];
	if (escapes) args.push("-e", "-J");
	return tmux(...args);
}

function waitFor(session, needle, deadlineMs, label) {
	const start = Date.now();
	while (Date.now() - start < deadlineMs) {
		let text = "";
		try {
			text = capture(session);
		} catch {
			// session may not be ready yet
		}
		if (text.includes(needle)) return { ok: true, waitedMs: Date.now() - start };
		spawnSync("sleep", ["0.5"]);
	}
	return { ok: false, waitedMs: Date.now() - start, label, needle };
}

function seedOmoSandbox(box) {
	mkdirSync(box.home, { recursive: true });
	mkdirSync(box.xdg, { recursive: true });
	const settings = {
		defaultProjectTrust: "ask",
		packages: [join(OMO_WT, "packages/omo-senpi/plugin")],
		retry: {
			enabled: true,
			maxRetries: 1,
			baseDelayMs: 1,
			modelFallback: true,
			fallbackChains: { "omo-mock/claude-fable-5": ["omo-mock/mock-weak"] },
		},
	};
	writeFileSync(join(box.agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
	writeFileSync(join(box.agentDir, "trust.json"), `${JSON.stringify({ [box.cwd]: true }, null, 2)}\n`);
	mkdirSync(join(box.cwd, ".omo"), { recursive: true });
	writeFileSync(
		join(box.cwd, ".omo", "omo.json"),
		`${JSON.stringify({ categories: { architect: { model: "anthropic/claude-fable-5", variant: "xhigh" } } }, null, 2)}\n`,
	);
	writeFileSync(join(box.cwd, "mock-script.json"), `${JSON.stringify({ primaryOutcome: "refusal" }, null, 2)}\n`);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	mkdirSync(args.out, { recursive: true });
	const authBefore = sha256OrNull(REAL_AUTH);
	const box = {
		dir: mkdtempSync(join(tmpdir(), `tip-tui-${args.mode}-`)),
	};
	box.agentDir = join(box.dir, "agent");
	box.sessionDir = join(box.dir, "sessions");
	box.cwd = join(box.dir, "work");
	box.home = join(box.dir, "home");
	box.xdg = join(box.dir, "xdg");
	for (const d of [box.agentDir, box.sessionDir, box.cwd]) mkdirSync(d, { recursive: true });

	const session = `ulw-tip-${args.mode}-${process.pid}`;
	const launcher = join(box.dir, "launch.sh");
	let commandLine;
	let envLines;
	if (args.mode === "senpi-startup") {
		envLines = [
			`export SENPI_CODING_AGENT_DIR=${JSON.stringify(box.agentDir)}`,
			`export SENPI_CODING_AGENT_SESSION_DIR=${JSON.stringify(box.sessionDir)}`,
			`export PI_OFFLINE=1 PI_TELEMETRY=0 PAGER=cat GIT_PAGER=cat`,
		];
		commandLine = `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(SENPI_WT, "node_modules/tsx/dist/cli.mjs"))} --tsconfig ${JSON.stringify(join(SENPI_WT, "tsconfig.json"))} ${JSON.stringify(join(SENPI_WT, "packages/coding-agent/src/cli.ts"))} --approve --no-context-files --no-skills --no-extensions`;
	} else {
		seedOmoSandbox(box);
		envLines = [
			`export HOME=${JSON.stringify(box.home)}`,
			`export USERPROFILE=${JSON.stringify(box.home)}`,
			`export XDG_CONFIG_HOME=${JSON.stringify(box.xdg)}`,
			`export SENPI_CODING_AGENT_DIR=${JSON.stringify(box.agentDir)}`,
			`export SENPI_CODING_AGENT_SESSION_DIR=${JSON.stringify(box.sessionDir)}`,
			`export OMO_SENPI_QA=1 OMO_SENPI_DISABLE_POSTHOG=1 PI_OFFLINE=1 PI_TELEMETRY=0 PAGER=cat GIT_PAGER=cat`,
		];
		commandLine = `exec ${JSON.stringify(SENPI_BIN)} -e ${JSON.stringify(MOCK_PROVIDER)} --provider omo-mock --model claude-fable-5 --session-dir ${JSON.stringify(box.sessionDir)} --approve --no-context-files`;
	}
	writeFileSync(launcher, `#!/bin/bash\nset -euo pipefail\ncd ${JSON.stringify(box.cwd)}\n${envLines.join("\n")}\n${commandLine}\n`);
	spawnSync("chmod", ["+x", launcher]);

	const result = { mode: args.mode, checks: [], startedAt: new Date().toISOString() };
	const check = (name, ok, detail) => {
		result.checks.push({ name, ok, detail });
		console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
	};

	try {
		tmux("new-session", "-d", "-s", session, "-x", String(COLS), "-y", String(ROWS), launcher);
		check("tmux session started", true, session);

		const boot = waitFor(session, "Tip:", 60_000, "boot");
		check("TUI booted (startup Tip visible)", boot.ok, `${boot.waitedMs}ms`);

		if (args.mode === "omo-fallback") {
			tmux("send-keys", "-t", session, "-l", "design a caching layer for the fixture service");
			tmux("send-keys", "-t", session, "Enter");
			const answered = waitFor(session, "fallback model answered", 90_000, "fallback-answer");
			check("fallback model answered after refusal", answered.ok, `${answered.waitedMs}ms`);
		}

		const tip = waitFor(session, "give-me-tips", args.mode === "omo-fallback" ? 30_000 : 20_000, "tip-pointer");
		check("give-me-tips pointer rendered", tip.ok, `${tip.waitedMs}ms`);

		const plain = capture(session);
		const raw = capture(session, { escapes: true });
		writeFileSync(join(args.out, `${args.mode}.txt`), plain);
		writeFileSync(join(args.out, `${args.mode}.ans`), raw);
		check("Tip line present", plain.includes("Tip:"));

		if (args.mode === "omo-fallback") {
			check("fallback model id (mock-weak) rendered in tip", plain.includes("mock-weak"));
		}

		// Replay headroom: -J-joined logical lines longer than COLS re-wrap on replay and would
		// scroll the header rows off a ROWS-sized grid; 2x rows keeps every row addressable.
		const xr = spawnSync(
			"node",
			[XTERM_RENDER, "render", join(args.out, `${args.mode}.ans`), "--cols", String(COLS), "--rows", String(ROWS * 2), "--out-json", join(args.out, `${args.mode}.grid.json`), "--out-html", join(args.out, `${args.mode}.html`), "--title", args.mode],
			{ encoding: "utf8", timeout: 60_000 },
		);
		check("xterm-render triplet produced", xr.status === 0, (xr.stderr || xr.stdout || "").slice(0, 200));
		if (xr.status === 0) {
			const grid = JSON.parse(readFileSync(join(args.out, `${args.mode}.grid.json`), "utf8"));
			const lines = grid.cells.map((row) => row.map((cell) => cell.glyph).join(""));
			const text = lines.join("\n");
			check("give-me-tips present in cell grid", text.includes("give-me-tips"));
			if (args.mode === "omo-fallback") check("mock-weak present in cell grid", text.includes("mock-weak"));
		}
	} catch (error) {
		check("driver completed without exception", false, String(error?.message ?? error).slice(0, 300));
	} finally {
		try {
			tmux("kill-session", "-t", session);
		} catch {}
		const authAfter = sha256OrNull(REAL_AUTH);
		result.finishedAt = new Date().toISOString();
		const hasSession = spawnSync("tmux", ["has-session", "-t", session]).status === 0;
		result.cleanup = {
			tmuxSessionKilled: !hasSession,
			sandboxRemoved: box.dir,
			realAuthUnchanged: authBefore === authAfter,
		};
		try {
			rmSync(box.dir, { recursive: true, force: true });
			result.cleanup.sandboxRemoved = !existsSync(box.dir) ? box.dir : `FAILED to remove ${box.dir}`;
		} catch (error) {
			result.cleanup.sandboxRemoved = `FAILED: ${error?.message ?? error}`;
		}
		writeFileSync(join(args.out, `${args.mode}-receipt.json`), `${JSON.stringify(result, null, 2)}\n`);
	}

	const failed = result.checks.filter((c) => !c.ok);
	const passed = failed.length === 0 && result.cleanup.realAuthUnchanged;
	console.log(JSON.stringify({ result: passed ? "PASS" : "FAIL", mode: args.mode, failedChecks: failed.map((f) => f.name), cleanup: result.cleanup }, null, 2));
	process.exitCode = passed ? 0 : 1;
}

main();
