// EQ.omo (P0-06f) driver support: the status-channel split, the ranked-timestamp offset, the fixed-path engine install
// and the sandbox process stop.
// Kept apart from fused-equivalence-e2e.mjs so each rule has its own unit test (fused-equivalence-support.test.mjs).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The plugin's status publishers (`omo.<component>.updated` extension events: task, dag, memory) and the
 * fire-and-forget footer/widget updates (`setStatus` / `setWidget`, keyed by their status or widget key) re-publish a
 * whole snapshot on their own coalescing schedule, so where a snapshot falls between two turn events is not ordered
 * against them. Each such channel is compared OUTSIDE the turn interleave (plan §6.2), as its snapshot count plus its
 * full ordered snapshot list. Nothing is dropped: a channel that published one snapshot more or less fails the compare.
 */
const STATUS_EVENT = /^omo\.[a-z-]+\.updated$/;
const STATUS_UI_METHODS = new Set(["setStatus", "setWidget"]);

function statusChannelOf(event) {
	if (event?.type === "extension_event" && STATUS_EVENT.test(event.name ?? "")) return event.name;
	if (event?.type === "extension_ui_request" && STATUS_UI_METHODS.has(event.method))
		return `${event.method}:${event.statusKey ?? event.widgetKey ?? ""}`;
	return undefined;
}

/**
 * One O6 client record with its status channels moved out of the turn list. The host's loaded-surface announcements
 * (`surfaces`) are already their own ordered list in the harness's O6 shape and pass through untouched.
 */
export function splitStatusChannels(client) {
	const listKey = Array.isArray(client.turn) ? "turn" : "events";
	const events = client[listKey];
	if (!Array.isArray(events)) throw new Error(`unexpected O6 shape from the harness: ${Object.keys(client).join(",")}`);
	const channels = new Map();
	for (const event of events) {
		const name = statusChannelOf(event);
		if (name === undefined) continue;
		if (!channels.has(name)) channels.set(name, []);
		channels.get(name).push(event);
	}
	return {
		...client,
		[listKey]: events.filter((event) => statusChannelOf(event) === undefined),
		status: Object.fromEntries([...channels].map(([name, snapshots]) => [name, { count: snapshots.length, snapshots }])),
	};
}

/** Per O6 client, each status channel's snapshot count: written to the receipt next to the compare result. */
export function statusCounts(observations) {
	return (observations?.O6 ?? []).map((client) =>
		Object.fromEntries(Object.entries(client.status ?? {}).map(([name, channel]) => [name, channel.count])),
	);
}

/**
 * Rows the recording host leaked into an observation (#12015, #12054): the OmO Native telemetry consent notice, which the
 * driver's telemetry opt-out keeps out of every case, and the terminal extension's monitor/wake restore events, which
 * only appear when host terminal state reaches the sandbox. A golden carrying either describes the recording machine,
 * not the engine, so the recorder refuses to write it and the committed goldens are checked for it.
 */
const HOST_LEAK_MARKERS = [
	{ reason: "telemetry notice", test: (value) => typeof value === "string" && value.includes("OmO Native sends anonymous usage telemetry") },
	{ reason: "terminal_monitor_state event", test: (value) => value === "terminal_monitor_state" },
	{ reason: "wake_source_state event", test: (value) => value === "wake_source_state" },
];

export function goldenHostLeaks(node, path = "$") {
	if (Array.isArray(node)) return node.flatMap((item, index) => goldenHostLeaks(item, `${path}[${index}]`));
	if (node && typeof node === "object")
		return Object.entries(node).flatMap(([key, value]) => goldenHostLeaks(value, `${path}.${key}`));
	return HOST_LEAK_MARKERS.filter((marker) => marker.test(node)).map((marker) => ({ path, reason: marker.reason }));
}

/**
 * A ranked timestamp's zone designator, left behind by the harness normalizer: its DATETIME rule absorbs a trailing `Z`
 * but not a numeric offset, so one commit time (git `%cI`, e.g. `previousEntryAtISO`) normalizes as `<ts:...:1>` from
 * git >= 2.45 in UTC, `<ts:...:1>+00:00` from older git, and `<ts:...:1>+09:00` on a KST host. The offset is part of the
 * timestamp the rank already replaced (plan §6.2: wall-clock values are never compared), so it goes with it. Only an
 * offset directly after a rank token is dropped; any other text keeps its offset.
 */
const RANKED_TIMESTAMP_OFFSET = /(<ts:[^>]+>)[+-]\d{2}:\d{2}/g;

export function dropTimestampOffsets(node) {
	if (typeof node === "string") return node.replace(RANKED_TIMESTAMP_OFFSET, "$1");
	if (Array.isArray(node)) return node.map(dropTimestampOffsets);
	if (!node || typeof node !== "object") return node;
	return Object.fromEntries(
		Object.entries(node).map(([key, value]) => [dropTimestampOffsets(key), dropTimestampOffsets(value)]),
	);
}

/**
 * The senpi CLI snapshots its own package under `<agentDir>/runtime/<buildId>-<installId>`, where the install id is
 * `sha256(realpath(packageDir)).slice(0, 12)` (senpi packages/coding-agent/src/runtime-snapshot/enter.ts:59). That
 * directory reaches the system prompt (skill roots, the codemode skill path), so a case run from an engine installed at
 * a checkout-dependent path records a checkout-dependent golden. The driver therefore runs the engine from a copy at
 * this fixed path, whatever checkout or machine runs the case.
 */
const ENGINE_PIN_ROOT = "/tmp/omo-eq-engine";

const isAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
};

/** One driver at a time owns the fixed path; a lock whose owner is gone is taken over. */
function acquirePin(lockPath) {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
			return;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			const owner = Number.parseInt(readFileSync(lockPath, "utf8"), 10);
			if (Number.isInteger(owner) && owner !== process.pid && isAlive(owner))
				throw new Error(
					`another EQ.omo driver (pid ${owner}) owns ${dirname(lockPath)}: run the cases in one driver process (--cases E21,E22,...)`,
				);
			rmSync(lockPath, { force: true });
		}
	}
	throw new Error(`could not take the EQ.omo engine lock ${lockPath}`);
}

/**
 * Copy the senpi package at `packageDir` to `<root>/node_modules/<name>`. With `mirrorSiblings`, every other entry of
 * the node_modules directory holding the package is linked beside the copy, so the copy resolves exactly the
 * dependencies the install resolves (and the runtime snapshot copies them from there, by realpath).
 */
export function pinEnginePackage(packageDir, { root = ENGINE_PIN_ROOT, mirrorSiblings = true } = {}) {
	const source = realpathSync(packageDir);
	const { name } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	if (typeof name !== "string" || !name) throw new Error(`${source}/package.json has no package name`);
	const lockPath = `${root}.lock`;
	acquirePin(lockPath);
	try {
		rmSync(root, { recursive: true, force: true });
		const modules = join(root, "node_modules");
		const target = join(modules, ...name.split("/"));
		mkdirSync(dirname(target), { recursive: true });
		cpSync(source, target, { recursive: true, verbatimSymlinks: true });
		if (mirrorSiblings) {
			const scoped = name.startsWith("@");
			const sourceModules = scoped ? dirname(dirname(source)) : dirname(source);
			if (basename(sourceModules) !== "node_modules")
				throw new Error(`${source} is not installed inside a node_modules directory`);
			for (const entry of readdirSync(sourceModules)) {
				if (entry.startsWith("@")) {
					mkdirSync(join(modules, entry), { recursive: true });
					for (const inner of readdirSync(join(sourceModules, entry))) {
						if (`${entry}/${inner}` === name) continue;
						symlinkSync(join(sourceModules, entry, inner), join(modules, entry, inner));
					}
				} else if (entry !== name) symlinkSync(join(sourceModules, entry), join(modules, entry));
			}
		}
		return {
			packageDir: target,
			release() {
				rmSync(root, { recursive: true, force: true });
				rmSync(lockPath, { force: true });
			},
		};
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		rmSync(lockPath, { force: true });
		throw error;
	}
}

/** This user's processes with their command line and environment (`ps e`), as `{ pid, command }`. */
function listProcesses() {
	const out = spawnSync("ps", ["axeww", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (out.error) throw out.error;
	if (out.status !== 0) throw new Error(`ps exited ${out.status}: ${out.stderr}`);
	return out.stdout
		.split("\n")
		.map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
		.filter(Boolean)
		.map((match) => ({ pid: Number(match[1]), command: match[2] }));
}

const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Stop what a case's plugin started on its own and detached (the task host supervisor and its RPC host, the LSP
 * daemon): they outlive the CLI child. Only processes whose command line or environment names this run's sandbox are
 * signalled; every such process inherited the sandbox HOME. After the SIGKILL the process list is read again until no
 * such process is left or `deadlineMs` passes. Returns how many were signalled, the pids still alive at the deadline,
 * and every signal error other than "already gone" (ESRCH); the caller fails the case on survivors or errors.
 */
export function stopSandboxProcesses(
	sandboxDir,
	{ list = listProcesses, kill = (pid) => process.kill(pid, "SIGKILL"), deadlineMs = 5_000, now = Date.now, pause = pauseSync } = {},
) {
	const matching = () =>
		list()
			.filter(({ pid, command }) => command.includes(sandboxDir) && pid !== process.pid)
			.map(({ pid }) => pid);
	const pids = matching();
	const errors = [];
	for (const pid of pids) {
		try {
			kill(pid);
		} catch (error) {
			if (error?.code !== "ESRCH") errors.push(`pid ${pid}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const deadline = now() + deadlineMs;
	let survivors = pids.length === 0 ? [] : matching();
	while (survivors.length > 0 && now() < deadline) {
		pause(100);
		survivors = matching();
	}
	return { signalled: pids.length, survivors, errors };
}
