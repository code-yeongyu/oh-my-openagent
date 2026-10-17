#!/usr/bin/env bun
// Linux live QA driver for the desktop engine: X11 under Xvfb + xfwm4, Wayland on `sway --headless`.
// Runs ON the Linux host under test (Debian-family, user-level tools only):
//
//   bun script/qa/desktop/linux.ts --all --json [--provision] [--workdir DIR] [--engine BIN]
//       [--fake-eis BIN] [--scenario NAME]... [--sabotage skip-optin]
//
// The engine defaults to `locateDesktopEngine()` from `@oh-my-opencode/senpi-desktop-engine` (the
// repository's `target/release/senpi-desktop-engine` on a dev host) and must pass that package's
// `engine.hello` ABI handshake before any scenario runs. The fake EIS server defaults to
// `<workdir>/target/release/senpi-qa-fake-eis`, built from `script/qa/desktop/linux/fake-eis`.
//
// One JSON line per scenario `{scenario, pass, facts, observer: {before, after}}`, then the teardown
// receipts (`procs 0`, `dir REMOVED <run dir>`) as the last lines; exit 0 iff every line passed.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { helloDesktopEngine, locateDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine";

import { exists, Processes } from "./linux/procs.ts";
import { provision, toolEnv } from "./linux/provision.ts";
import { type Context, failure, type Result, SABOTAGES, type Sabotage } from "./linux/scenario.ts";
import { startWayland } from "./linux/wayland-env.ts";
import { runWayland, WAYLAND_SCENARIOS, type WaylandScenario } from "./linux/wayland.ts";
import { startX11 } from "./linux/x11-env.ts";
import { runX11, X11_SCENARIOS, type X11Scenario } from "./linux/x11.ts";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const { values } = parseArgs({
	options: {
		all: { type: "boolean", default: false },
		json: { type: "boolean", default: false },
		provision: { type: "boolean", default: false },
		scenario: { type: "string", multiple: true, default: [] },
		sabotage: { type: "string" },
		workdir: { type: "string" },
		engine: { type: "string" },
		"fake-eis": { type: "string" },
	},
});

function isX11(name: string): name is X11Scenario {
	return X11_SCENARIOS.some((known) => known === name);
}

function isWayland(name: string): name is WaylandScenario {
	return WAYLAND_SCENARIOS.some((known) => known === name);
}

function isSabotage(mode: string): mode is Sabotage {
	return SABOTAGES.some((known) => known === mode);
}

function usage(message: string): never {
	process.stderr.write(`qa-desktop-linux: ${message}\n`);
	process.exit(2);
}

function engineBinary(): string {
	if (values.engine !== undefined) return values.engine;
	const located = locateDesktopEngine({
		repoRoot: REPO_ROOT,
		packageDir: join(REPO_ROOT, "packages/senpi-desktop-engine"),
	});
	if (located.path === null) usage(`${located.diagnostic.message} ${located.diagnostic.cause}`);
	return located.path;
}

if (process.platform !== "linux") usage(`runs on the Linux host under test, not ${process.platform}`);
const requested = values.all ? [...X11_SCENARIOS, ...WAYLAND_SCENARIOS] : values.scenario;
if (requested.length === 0) usage("pass --all or --scenario <name>");
const unknown = requested.filter((name) => !isX11(name) && !isWayland(name));
if (unknown.length > 0) usage(`unknown scenario(s): ${unknown.join(", ")}`);
const sabotage = values.sabotage;
if (sabotage !== undefined && !isSabotage(sabotage)) usage(`unknown sabotage mode ${sabotage}`);

const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const workdir = values.workdir ?? `/tmp/omo-desktop-qa-${stamp}-${process.pid}`;
const fakeEisBinary = values["fake-eis"] ?? join(workdir, "target/release/senpi-qa-fake-eis");
if (requested.some(isWayland) && !exists(fakeEisBinary)) usage(`no fake EIS server at ${fakeEisBinary} (--fake-eis)`);
const runId = `${Date.now()}-${process.pid}`;
const runDir = join(workdir, `run-${runId}`);
const procs = new Processes(runId, { ...process.env, ...toolEnv(join(workdir, "root"), process.env) });
const ctx: Context = { procs, engineBinary: engineBinary(), fakeEisBinary, runDir, sabotage };
mkdirSync(runDir, { recursive: true });

let allPassed = true;
function emit(line: Result | { receipt: string; pass: boolean }): void {
	const text = JSON.stringify(line);
	allPassed &&= line.pass;
	process.stdout.write(values.json ? `${text}\n` : `${"scenario" in line ? line.scenario : line.receipt}: ${line.pass ? "PASS" : "FAIL"}\n`);
}

async function family<T extends string, S, O>(
	names: readonly T[],
	start: () => Promise<{ stage: S; observe: O }>,
	run: (name: T, stage: S, observe: O) => Promise<Result>,
): Promise<void> {
	if (names.length === 0) return;
	let staged: { stage: S; observe: O };
	try {
		staged = await start();
	} catch (error) {
		for (const name of names) emit(failure(name, error));
		return;
	}
	for (const name of names) {
		try {
			emit(await run(name, staged.stage, staged.observe));
		} catch (error) {
			emit(failure(name, error));
		}
	}
}

try {
	if (values.provision) {
		for (const line of await provision(procs, workdir)) process.stderr.write(`${line}\n`);
	}
	const hello = await helloDesktopEngine(ctx.engineBinary).then(
		(reply) => ({ receipt: `engine ${ctx.engineBinary} abi ${reply.abi} protocol ${reply.protocolVersion}`, pass: true }),
		(error: unknown) => ({ receipt: `engine ${error instanceof Error ? error.message : String(error)}`, pass: false }),
	);
	emit(hello);
	if (!hello.pass) throw new Error("the engine failed the ABI handshake; no scenario ran");
	await family(
		requested.filter(isX11),
		() => startX11(procs, runDir),
		(name, stage, observe) => runX11(name, ctx, stage, observe),
	);
	await family(
		requested.filter(isWayland),
		() => startWayland(procs, runDir),
		(name, stage, observe) => runWayland(name, ctx, stage, observe),
	);
} catch (error) {
	process.stderr.write(`qa-desktop-linux: ${error instanceof Error ? error.message : String(error)}\n`);
	allPassed = false;
} finally {
	for (const receipt of await procs.stopAll()) process.stderr.write(`teardown: ${receipt}\n`);
	const left = procs.marked().length;
	emit({ receipt: `procs ${left}`, pass: left === 0 });
	rmSync(runDir, { recursive: true, force: true });
	const removed = !exists(runDir);
	emit({ receipt: `dir ${removed ? "REMOVED" : "LEFT"} ${runDir}`, pass: removed });
}
process.exitCode = allPassed ? 0 : 1;
