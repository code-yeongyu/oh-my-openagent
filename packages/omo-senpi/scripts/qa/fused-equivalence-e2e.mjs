#!/usr/bin/env node
// EQ.omo (brain/hand plan P0-06f, §6.2-§6.4): the omo-senpi plugin's fused-path equivalence cases E21-E24.
//
// Each case drives the REAL senpi CLI (`--mode rpc`, persisted session) with the BUILT plugin
// (packages/omo-senpi/plugin) against the senpi EQ harness's fake model server, collects O1-O7 (E21 also O8),
// normalizes them with the harness normalizer, and compares them with the B0 goldens in
// fused-equivalence-golden/<platform>-<arch>/ (`--compare`) or writes those goldens (`--record`, written only when
// every `--repeat` run agreed). The pipeline witness is read separately and never takes part in the equality.
//
//   node packages/omo-senpi/scripts/qa/fused-equivalence-e2e.mjs --compare [--placement fused] [--cases E21,E24]
//     [--engine <senpi tarball | compiled senpi binary>] [--senpi-repo <senpi checkout>] [--desktop-engine <path>]
//     [--lsp-dir <dir>] [--repeat N] [--evidence-dir <dir>]
//
// The CLI child sees a fixed PATH: the dirs of bun, node and git, /usr/bin and /bin, plus `--lsp-dir` (or
// EQ_LSP_DIR), which must hold the pinned `typescript-language-server` E24 needs. A host's own language servers never
// reach a case, so what E24 observes does not depend on what the recording machine happens to have installed.
// No host path reaches a golden either: the child's TMPDIR is pinned inside the case sandbox, and a CLI script engine
// runs from a copy of its package at the fixed ENGINE_PIN_ROOT (one driver process at a time owns that path).
//
// The collectors, normalizer, fake model server and case runner are the senpi EQ harness
// (senpi .agents/skills/senpi-qa, plan node P0-05b), read from a senpi checkout: `--senpi-repo` or SENPI_QA_REPO.
// The engine is the senpi CLI the plugin pins (node_modules/@code-yeongyu/senpi) run on Bun, unless `--engine` names
// a senpi package tarball (its CLI also runs on Bun) or a compiled senpi binary. The CLI child never runs on Node.
// Exit 0 only when every selected case matches its golden on every declared observable and its witness is `legacy`.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	dropTimestampOffsets,
	goldenHostLeaks,
	pinEnginePackage,
	splitStatusChannels,
	statusCounts,
	stopSandboxProcesses,
} from "./fused-equivalence-support.mjs";
import { prepareCaseSandbox } from "./fused-equivalence-sandbox.mjs";
import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..", "..");
const repoRoot = resolve(packageRoot, "..", "..");
const pluginRoot = join(packageRoot, "plugin");
const goldenRoot = join(scriptDir, "fused-equivalence-golden");
const fakeDesktop = join(repoRoot, "crates", "senpi-desktop-backend-fake", "fixtures", "two-displays-one-window.json");
const HARNESS = join(".agents", "skills", "senpi-qa");

/** Placements whose producers come later in the plan; asking for one is an error, never a PASS. */
const DEFERRED_PLACEMENTS = { "split-local": "O14", "split-remote": "DM1", hosted: "V4" };
const CASE_IDS = ["E21", "E22", "E23", "E24"];
const ALL_OBSERVABLES = ["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8"];
const WITHOUT_O8 = ALL_OBSERVABLES.slice(0, 7);
/**
 * Id namespaces the plugin generates per run, by the key that carries them (plan §6.2: one-to-one first-occurrence token
 * maps per id namespace). The harness normalizer maps its own id keys; these are the plugin's: task ids are
 * time-derived, a memory identity and its binding hash are derived from the sandbox path, and a memory commit sha
 * hashes its date. A short sha (a 7+ character prefix of a mapped sha) maps to the same token with `:short`.
 */
const PLUGIN_ID_KEYS = {
	task_id: ["task", /^st_[0-9a-f]{8}$/],
	childId: ["task", /^st_[0-9a-f]{8}$/],
	identity: ["memory-identity", /^[a-z0-9-]+-[0-9a-f]{8}$/],
	repoPathHash: ["repo-path-hash", /^[0-9a-f]{64}$/],
	headSha: ["sha", /^[0-9a-f]{40}$/],
	sha: ["sha", /^[0-9a-f]{40}$/],
};

function parseArgs(argv) {
	const value = (flag) => {
		const index = argv.indexOf(flag);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const mode = argv.includes("--record") ? "record" : argv.includes("--compare") ? "compare" : undefined;
	if (!mode) throw new Error("pass --compare or --record");
	const placement = value("--placement") ?? "fused";
	if (DEFERRED_PLACEMENTS[placement])
		throw new Error(`--placement ${placement} is DEFERRED(${DEFERRED_PLACEMENTS[placement]}): its producer has not landed`);
	if (placement !== "fused") throw new Error(`unknown --placement ${placement}`);
	const selected = value("--cases")
		?.split(",")
		.map((id) => id.trim().toUpperCase());
	const unknown = (selected ?? []).filter((id) => !CASE_IDS.includes(id));
	if (unknown.length) throw new Error(`unknown case(s): ${unknown.join(", ")}`);
	const repeat = Number.parseInt(value("--repeat") ?? "1", 10);
	if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
	const senpiRepo = value("--senpi-repo") ?? process.env.SENPI_QA_REPO;
	if (!senpiRepo) throw new Error("the senpi EQ harness is required: pass --senpi-repo <senpi checkout> or set SENPI_QA_REPO");
	const harness = join(resolve(senpiRepo), HARNESS);
	if (!existsSync(join(harness, "scenarios", "fused-equivalence", "cases", "support", "case-run.mjs")))
		throw new Error(`${senpiRepo} has no senpi EQ harness (${HARNESS}/scenarios/fused-equivalence, plan P0-05b)`);
	return {
		mode,
		placement,
		selected,
		repeat,
		harness,
		engine: value("--engine"),
		desktopEngine: resolve(value("--desktop-engine") ?? join(repoRoot, "target", "release", "senpi-desktop-engine")),
		evidenceDir: value("--evidence-dir"),
		lspDir: value("--lsp-dir") ?? process.env.EQ_LSP_DIR,
	};
}

function bunVersion() {
	const out = spawnSync("bun", ["--version"], { encoding: "utf8", env: withTelemetryOptOut(process.env) });
	if (out.status !== 0) throw new Error("the CLI child runs on Bun: no `bun` on PATH");
	return out.stdout.trim();
}

/**
 * The engine the cases run, as the harness's `--child binary:<path>` plus the receipt's `child_runtime`. A senpi CLI
 * script (the pinned package or a tarball's) runs on Bun through a launcher, from a copy of its package at the fixed
 * ENGINE_PIN_ROOT (see pinEnginePackage: the engine's runtime snapshot directory hashes its package path); `release`
 * removes that copy. A compiled binary runs as itself.
 */
function resolveEngine(engine, workDir) {
	let cli;
	let identity;
	if (engine === undefined || /\.(tgz|tar\.gz)$/.test(engine)) {
		let manifestPath;
		if (engine === undefined) {
			// The package exports neither `.` for require nor ./package.json: find it the way Node's lookup walks node_modules.
			for (let dir = packageRoot; manifestPath === undefined; dir = dirname(dir)) {
				const candidate = join(dir, "node_modules", "@code-yeongyu", "senpi", "package.json");
				if (existsSync(candidate)) manifestPath = candidate;
				else if (dir === dirname(dir)) throw new Error("@code-yeongyu/senpi is not installed: run bun install");
			}
		} else {
			const unpacked = join(workDir, "engine");
			mkdirSync(unpacked, { recursive: true });
			const tar = spawnSync("tar", ["-xzf", resolve(engine), "-C", unpacked], { encoding: "utf8" });
			if (tar.status !== 0) throw new Error(`could not unpack --engine ${engine}: ${tar.stderr}`);
			manifestPath = join(unpacked, "package", "package.json");
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const pin = pinEnginePackage(dirname(manifestPath), { mirrorSiblings: engine === undefined });
		cli = join(pin.packageDir, manifest.bin?.senpi ?? "dist/bundle/cli.js");
		if (!existsSync(cli)) {
			pin.release();
			throw new Error(`the senpi package at ${dirname(manifestPath)} has no CLI ${cli}`);
		}
		const bun = bunVersion();
		const launcher = join(workDir, "senpi-on-bun.sh");
		writeFileSync(launcher, `#!/bin/sh\nexec bun ${JSON.stringify(cli)} "$@"\n`);
		chmodSync(launcher, 0o755);
		identity = `bun@${bun} ${manifest.name}@${manifest.version}${engine === undefined ? " (pinned)" : " (tarball)"}`;
		return { child: launcher, cliDir: pin.packageDir, childRuntime: identity, release: pin.release };
	}
	if (!existsSync(engine)) throw new Error(`--engine: no file at ${engine}`);
	return {
		child: resolve(engine),
		cliDir: dirname(resolve(engine)),
		childRuntime: `binary:${resolve(engine)}`,
		release: () => {},
	};
}

/** The executable dirs a case's CLI child may use (see the header): never the host's full PATH. */
function childPath(lspDir) {
	const which = (name) => {
		const out = spawnSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8", env: withTelemetryOptOut(process.env) });
		return out.status === 0 ? dirname(out.stdout.trim()) : undefined;
	};
	const dirs = [lspDir && resolve(lspDir), which("bun"), dirname(process.execPath), which("git"), "/usr/bin", "/bin"];
	return [...new Set(dirs.filter(Boolean))].join(":");
}


const SETTINGS = { packages: [pluginRoot], defaultProjectTrust: "ask" };
const E24_WARM_BARRIER = "eq-e24-lsp-warm";

/** E21: a successful `computer` run's result must carry the click's audit record (see E21's comment). */
function assertClickAudited(run) {
	const end = run.client.events.find((event) => event.type === "tool_execution_end" && event.toolName === "computer");
	if (!end) throw new Error("E21: the computer tool never finished");
	if (end.isError) return;
	const audit = end.result?.details?.audit ?? [];
	if (!audit.some((record) => record.action === "click"))
		throw new Error(`E21: the computer run's audit has no click record: ${JSON.stringify(audit).slice(0, 400)}`);
}
/** The fake provider's model, as a category model reference. */
const FAKE_MODEL = "mock/mock-model";

/**
 * Answer every extension UI request the way a client that confirms would, and record each one (O5 `extra`), so a
 * dialog the plugin raises is part of the comparison and never hangs the case.
 */
function answerUiRequests(run) {
	const client = run.client;
	const answered = new Set();
	const answer = (event) => {
		if (event?.type !== "extension_ui_request" || answered.has(event.id)) return;
		answered.add(event.id);
		if (["confirm", "select", "input", "editor"].includes(event.method)) {
			run.effects.push({ ui: event.method, title: event.title ?? null });
			const reply =
				event.method === "confirm"
					? { confirmed: true }
					: event.method === "select"
						? { value: event.options?.[0] }
						: { value: "" };
			client.child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, ...reply })}\n`);
		}
	};
	const original = client.events.push.bind(client.events);
	client.events.push = (...items) => {
		const length = original(...items);
		for (const item of items) answer(item);
		return length;
	};
}

const cases = [
	{
		id: "E21",
		title: "computer-use per-call marker",
		observables: ALL_OBSERVABLES,
		needsDesktopEngine: true,
		// The run ends with a screenshot after the click. The engine writes a request's audit notification right after that
		// request's reply and before any later reply (senpi-desktop-engine/src/outbox.rs:1-7), and the run's audit list is
		// copied when its code settles (senpi-desktop-service/src/run/runtime.ts:186-191). The trailing screenshot's reply is
		// therefore the protocol event after which the click's audit has been delivered; drive() asserts it was.
		spec: () => ({
			settings: SETTINGS,
			turns: [
				{
					toolCalls: [
						{
							id: "call_cu",
							name: "computer",
							args: {
								action: "run",
								code: "const all = await desktop.display('all'); const two = await desktop.display('2'); const a = await all.screenshot({ silent: true }); const b = await two.screenshot({ silent: true }); await two.click(20, 10); await two.screenshot({ silent: true }); return JSON.stringify({ all: [a.width, a.height], two: [b.width, b.height] })",
							},
						},
					],
				},
				{ text: "E21-DONE" },
			],
		}),
		async drive(run, options) {
			prepareCaseSandbox(run, {
				computer: { engine_path: options.desktopEngine, allow_host_relay_only_stop: true },
			});
			run.env.SENPI_DESKTOP_BACKEND = `fake:${fakeDesktop}`;
			await run.open();
			answerUiRequests(run);
			await run.prompt("drive display 2 with one per-call display handle");
			assertClickAudited(run);
			await run.close();
			await run.reopenState();
		},
	},
	{
		id: "E22",
		title: "task sub-agent (E1)",
		observables: WITHOUT_O8,
		spec: () => ({
			settings: SETTINGS,
			turns: [
				{
					toolCalls: [
						{
							id: "call_task",
							name: "task",
							args: { category: "eqcat", prompt: "say CHILD-DONE", run_in_background: false, name: "eqchild" },
						},
					],
				},
				{ text: "CHILD-DONE" },
				{ text: "E22-DONE" },
			],
		}),
		async drive(run) {
			prepareCaseSandbox(run, {
				categories: { eqcat: { description: "EQ category pinned to the fake model", model: FAKE_MODEL } },
				task: { default_execution_mode: "in-process" },
			});
			await run.open();
			answerUiRequests(run);
			await run.prompt("delegate one foreground sub-agent");
			await run.close();
		},
	},
	{
		id: "E23",
		title: "memory",
		observables: WITHOUT_O8,
		spec: () => ({
			settings: SETTINGS,
			turns: [
				{
					toolCalls: [
						{
							id: "call_mem",
							name: "memory",
							args: {
								command: "create",
								file_path: "system/eq-facts.md",
								description: "EQ facts",
								file_text: "the EQ harness pins today's memory tool",
								reason: "seed an EQ fact",
							},
						},
					],
				},
				{ text: "E23-DONE" },
			],
		}),
		async drive(run) {
			prepareCaseSandbox(run, {
				categories: { quick: { description: "EQ quick category", model: FAKE_MODEL } },
				memory: { enabled: true, reflection: { trigger: { step_count: 0, on_compaction: false } } },
			});
			await run.open();
			answerUiRequests(run);
			await run.prompt("remember one EQ fact");
			await run.close();
		},
	},
	{
		id: "E24",
		title: "comment-checker/lsp after a write",
		observables: WITHOUT_O8,
		spec: () => ({
			settings: SETTINGS,
			turns: [
				// The first write starts the TypeScript server and carries a type error of its own. The checked write's turn is
				// held at the fake model server until drive() has seen the warm write's result carry that error: the event
				// that proves the server answers inside the plugin's diagnostics freshness window (lsp-core client.ts:26).
				{
					toolCalls: [
						{ id: "call_warm", name: "write", args: { path: "eq-warm.ts", content: "export const eqWarm: string = 1\n" } },
					],
				},
				{
					holdUntil: E24_WARM_BARRIER,
					toolCalls: [
						{
							id: "call_write",
							name: "write",
							args: {
								path: "eq-sample.ts",
								content: "// this function adds two numbers\nexport const eqValue: string = 1\n",
							},
						},
					],
				},
				{ text: "E24-DONE" },
			],
		}),
		async drive(run, options) {
			if (!options.lspDir || !existsSync(join(options.lspDir, "typescript-language-server")))
				throw new Error("E24 needs the pinned typescript-language-server: pass --lsp-dir <dir> (or EQ_LSP_DIR)");
			prepareCaseSandbox(run, {});
			if (options.commentChecker) run.env.OMO_COMMENT_CHECKER_BIN = options.commentChecker;
			await run.open();
			answerUiRequests(run);
			const warmEnd = run.nextEvent((event) => event.type === "tool_execution_end" && event.toolCallId === "call_warm");
			const settled = run.prompt("write eq-sample.ts");
			settled.catch(() => {});
			const warm = await warmEnd;
			// A freshness timeout is rendered under the same "LSP errors detected" header, so the proof is the diagnostic itself.
			const warmText = JSON.stringify(warm.result?.content ?? []);
			if (!warmText.includes("error[typescript] (2322)"))
				throw new Error(
					`E24: the warm write got no TypeScript diagnostic inside the freshness window: ${warmText.slice(0, 400)}`,
				);
			run.server.releaseBarrier(E24_WARM_BARRIER);
			await settled;
			await run.close();
		},
	},
];

/** Literal roots for every plugin id the raw observations carry under a PLUGIN_ID_KEYS key, in first-occurrence order. */
function pluginIdRoots(raw) {
	const seen = new Map();
	const walk = (node, key) => {
		if (typeof node === "string") {
			const [namespace, shape] = (key !== undefined && Object.hasOwn(PLUGIN_ID_KEYS, key) && PLUGIN_ID_KEYS[key]) || [];
			if (namespace && shape.test(node) && !seen.has(node)) seen.set(node, namespace);
		} else if (Array.isArray(node)) node.forEach((item) => walk(item, key));
		else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, k);
	};
	walk(raw, undefined);
	const counters = new Map();
	const roots = [];
	for (const [value, namespace] of seen) {
		const index = (counters.get(namespace) ?? 0) + 1;
		counters.set(namespace, index);
		roots.push({ prefix: value, token: `<${namespace}:${index}>` });
		if (namespace === "sha")
			roots.push({ prefix: value.slice(0, 7), token: `<${namespace}:${index}:short>` });
	}
	return roots;
}

/**
 * A sub-agent's measured run time and the rate derived from it: durations, dropped like the harness drops its own. The
 * same rate is also rendered into the task's progress line (`\u00b7 333 tok/s`); there only the number is replaced.
 */
const PLUGIN_MEASUREMENT_KEYS = new Set(["runtime_ms", "tokens_per_second", "tokensPerSecond"]);
const RENDERED_RATE = /\b\d+(?:\.\d+)? tok\/s\b/g;

function dropMeasurements(node) {
	if (typeof node === "string") return node.replace(RENDERED_RATE, "<rate> tok/s");
	if (Array.isArray(node)) return node.map(dropMeasurements);
	if (!node || typeof node !== "object") return node;
	return Object.fromEntries(
		Object.entries(node)
			.filter(([key]) => !PLUGIN_MEASUREMENT_KEYS.has(key))
			.map(([key, value]) => [key, dropMeasurements(value)]),
	);
}

/**
 * The harness's observe() (fused-equivalence/cases/support/observe.mjs) with the plugin's own rules added: the status
 * channels split out, plugin measurements dropped, the plugin id namespaces token-mapped, and a ranked timestamp's zone
 * offset dropped with it. The run-scoped roots and host facts are the harness's, unchanged.
 */
function observeOmo(run, observables, harness) {
	const raw = Object.fromEntries(observables.map((id) => [id, dropMeasurements(harness.collectors[id](run))]));
	if (raw.O6) raw.O6 = raw.O6.map(splitStatusChannels);
	const normalize = harness.createNormalizer({
		roots: [
			{ prefix: run.box.dir, token: "<sandbox>" },
			{ prefix: run.box.dir.replaceAll("/", "-"), token: "<sandbox-key>" },
			{ prefix: run.repo, token: "<repo>" },
			{ prefix: run.server.origin, token: "<model-server>" },
			{ prefix: run.server.origin.replace(/^http:\/\//, ""), token: "<model-server-host>" },
			...run.extraRoots,
			...pluginIdRoots(raw),
		],
		hostFacts: [...harness.hostFacts(), ...harness.childRuntimeFacts(run.childRuntime)],
	});
	return Object.fromEntries(observables.map((id) => [id, dropTimestampOffsets(normalize(raw[id]))]));
}

function resolveCommentChecker() {
	try {
		return createRequire(join(repoRoot, "package.json")).resolve("@code-yeongyu/comment-checker/cli.js");
	} catch {
		return undefined;
	}
}

const sha256File = async (path) => {
	const { createHash } = await import("node:crypto");
	return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
};

function summarizeDiffs(diffs) {
	return diffs
		.slice(0, 12)
		.map(
			(row) =>
				`    ${row.path}: golden=${JSON.stringify(row.golden)?.slice(0, 160)} actual=${JSON.stringify(row.actual)?.slice(0, 160)}`,
		);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!existsSync(join(pluginRoot, "runtime", "lsp-daemon", "dist", "cli.js")))
		throw new Error("the plugin is not built: run `bun run build:senpi-plugin` first");
	const workDir = mkdtempSync(join(tmpdir(), "omo-eq-"));
	let engine;
	try {
		engine = resolveEngine(options.engine, workDir);
		// The harness reads its child runtime from argv once, on first use.
		process.argv.push("--child", `binary:${engine.child}`);
		const load = (rel) => import(pathToFileURL(join(options.harness, rel)).href);
		const { startCaseRun } = await load("scenarios/fused-equivalence/cases/support/case-run.mjs");
		const { collectors } = await load("scenarios/fused-equivalence/cases/support/collectors.mjs");
		const { childRuntimeFacts, goldenPlatform, hostFacts } = await load(
			"scenarios/fused-equivalence/cases/support/host.mjs",
		);
		const { expectedWitness, readWitness } = await load("scenarios/fused-equivalence/cases/support/witness.mjs");
		const { guardRealAuth, installCleanupHooks } = await load("scripts/lib/common.mjs");
		const { createNormalizer, diffNormalized } = await load("scripts/lib/equivalence-normalize.mjs");
		const harness = { collectors, createNormalizer, hostFacts, childRuntimeFacts };
		installCleanupHooks();
		const guard = guardRealAuth();
		const caseOptions = {
			desktopEngine: options.desktopEngine,
			commentChecker: resolveCommentChecker(),
			lspDir: options.lspDir,
		};
		const pathForChild = childPath(options.lspDir);
		const selected = cases.filter((c) => !options.selected || options.selected.includes(c.id));
		const dir = join(goldenRoot, goldenPlatform());
		const command = `node packages/omo-senpi/scripts/qa/fused-equivalence-e2e.mjs ${process.argv.slice(2, process.argv.indexOf("--child")).join(" ")}`;
		const witnessWanted = expectedWitness("default");
		const results = [];
		for (const testCase of selected) {
			const result = {
				id: testCase.id,
				title: testCase.title,
				observables: testCase.observables,
				runs: 0,
				statusCounts: [],
				cleanup: [],
			};
			const runs = [];
			try {
				if (testCase.needsDesktopEngine && !existsSync(options.desktopEngine))
					throw new Error(`no desktop engine at ${options.desktopEngine}; run cargo build --release -p senpi-desktop-engine`);
				for (let index = 0; index < options.repeat; index++) {
					const run = await startCaseRun({ ...testCase.spec(), label: `omo-${testCase.id.toLowerCase()}` });
					// The checkout and engine locations are run-scoped prefixes, like the sandbox root.
					run.extraRoots.push(
						{ prefix: repoRoot, token: "<omo-repo>" },
						{ prefix: engine.cliDir, token: "<engine>" },
						{ prefix: workDir, token: "<engine-work>" },
					);
					run.childPath = pathForChild;
					try {
						try {
							await testCase.drive(run, caseOptions);
						} catch (error) {
							const tails = run.clients.map((client, i) => `--- client ${i} stderr tail:\n${client.stderr.slice(-1500)}`);
							if (error instanceof Error) error.message = `${error.message}\n${tails.join("\n")}`;
							throw error;
						}
						const observations = observeOmo(run, testCase.observables, harness);
						result.statusCounts.push(statusCounts(observations));
						runs.push({ observations, witness: readWitness(run.sessionFile) });
					} finally {
						await run.stop();
						result.cleanup.push(stopSandboxProcesses(run.box.dir));
						run.box.cleanup();
					}
				}
			} catch (caught) {
				result.error = caught instanceof Error ? `${caught.message}\n${caught.stack ?? ""}` : String(caught);
			}
			// A detached process that survived its SIGKILL, or a signal that failed, fails the case: the next run would share it.
			const leftovers = result.cleanup.filter((stop) => stop.survivors.length > 0 || stop.errors.length > 0);
			if (leftovers.length > 0 && !result.error)
				result.error = `sandbox processes not stopped: ${JSON.stringify(leftovers)}`;
			result.runs = runs.length;
			const goldenPath = join(dir, `${testCase.id}.json`);
			if (!result.error) {
				const first = runs[0].observations;
				result.repeatDiffs = runs.slice(1).flatMap((other) => diffNormalized(first, other.observations));
				result.witness = runs[0].witness;
				result.witnessOk = runs.every((r) => r.witness.pipeline === witnessWanted);
				if (options.mode === "record") {
					// A golden is written only from runs that agreed with each other: a nondeterministic case is a FAIL.
					// One carrying a host-leaked row (telemetry notice, terminal restore events) is a FAIL too (#12054).
					const leaks = goldenHostLeaks(first);
					if (leaks.length > 0)
						result.error = `host-leaked rows, golden not written: ${leaks
							.slice(0, 5)
							.map((leak) => `${leak.reason} at ${leak.path}`)
							.join("; ")}`;
					else if (result.repeatDiffs.length === 0) {
						mkdirSync(dir, { recursive: true });
						writeFileSync(
							goldenPath,
							`${JSON.stringify({ id: testCase.id, title: testCase.title, observations: first }, null, 1)}\n`,
						);
					}
					result.diffs = [];
				} else {
					const golden = existsSync(goldenPath)
						? JSON.parse(readFileSync(goldenPath, "utf8")).observations
						: undefined;
					result.diffs = golden
						? diffNormalized(golden, first)
						: [{ path: "$", golden: "<missing golden>", actual: "<observed>" }];
				}
				result.allRuns = runs.map((r) => r.observations);
			}
			result.pass = !result.error && result.witnessOk && result.repeatDiffs.length === 0 && result.diffs.length === 0;
			process.stdout.write(
				`[${result.pass ? "PASS" : "FAIL"}] ${testCase.id} ${testCase.title}${result.error ? ` - ${result.error}` : ""}\n`,
			);
			for (const line of summarizeDiffs([...(result.diffs ?? []), ...(result.repeatDiffs ?? [])]))
				process.stdout.write(`${line}\n`);
			if (result.witnessOk === false)
				process.stdout.write(`    witness.pipeline=${result.witness.pipeline} expected=${witnessWanted}\n`);
			results.push(result);
		}
		guard.assertUnchanged();
		const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout?.trim() || null;
		const harnessHead =
			spawnSync("git", ["rev-parse", "HEAD"], { cwd: options.harness, encoding: "utf8" }).stdout?.trim() || null;
		const manifest = {
			repo: { head, harness: harnessHead },
			platform: goldenPlatform(),
			runtimes: { harness: `node@${process.versions.node}`, child: engine.childRuntime },
			hashes: {
				driver: await sha256File(fileURLToPath(import.meta.url)),
				normalizer: await sha256File(join(options.harness, "scripts", "lib", "equivalence-normalize.mjs")),
				fakeModelServer: await sha256File(join(options.harness, "scripts", "lib", "fake-model-server.mjs")),
				collectors: await sha256File(
					join(options.harness, "scenarios", "fused-equivalence", "cases", "support", "collectors.mjs"),
				),
			},
			// The committed manifest names the invocation without its machine-local paths; the local receipt keeps them.
			command: `node packages/omo-senpi/scripts/qa/fused-equivalence-e2e.mjs --${options.mode}${options.repeat > 1 ? ` --repeat ${options.repeat}` : ""}`,
		};
		if (options.mode === "record" && results.every((r) => r.pass)) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "baseline.json"), `${JSON.stringify(manifest, null, 1)}\n`);
		}
		const passed = results.filter((r) => r.pass).length;
		process.stdout.write(
			`\nfused-equivalence-e2e ${options.mode}: ${passed}/${results.length} passed (child_runtime=${engine.childRuntime})\n`,
		);
		if (options.evidenceDir) {
			mkdirSync(options.evidenceDir, { recursive: true });
			const receipt = { command, child_runtime: engine.childRuntime, manifest, results: results.map(({ allRuns, ...rest }) => rest) };
			writeFileSync(join(options.evidenceDir, "receipt.json"), `${JSON.stringify(receipt, null, 1)}\n`);
			for (const r of results)
				for (const [index, observations] of (r.allRuns ?? []).entries())
					writeFileSync(
						join(options.evidenceDir, `${r.id}.run${index + 1}.observed.json`),
						`${JSON.stringify(observations, null, 1)}\n`,
					);
			process.stdout.write(`evidence: ${options.evidenceDir}\n`);
		}
		process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
	} finally {
		engine?.release();
		rmSync(workDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
	process.exitCode = 2;
});
