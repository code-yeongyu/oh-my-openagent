#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { BUILD_NODES, selectBuildNodes, type BuildNode } from "./build-nodes";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";

// Detach each child on POSIX so it leads its own process group, letting us SIGKILL the whole
// group (child + any grandchildren it spawned, e.g. `npm ci` / `bun build` sub-processes) on
// abort. A plain child.kill() only signals the immediate child, so grandchildren survive and a
// failed build would otherwise wait out a slow sibling. On Windows there is no process group;
// killTree falls back to `taskkill /T /F`, which is best-effort tree termination.
function killTree(child: ReturnType<typeof spawn>): void {
	const pid = child.pid;
	if (pid === undefined) return;
	if (isWindows) {
		spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		// ESRCH => the group is already gone (child exited between the race and this loop); any
		// other failure (e.g. the child never became a group leader) falls back to a direct kill.
		if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
		child.kill("SIGKILL");
	}
}

// Every node writes to a disjoint output path, so ordering only matters where one node
// reads another's output. The three real edges: index -> node-require-shim (patches
// dist/index.js), materialize -> skills-assets and materialize -> codex-plugin (both read
// the materialized packages/shared-skills/skills). materialize is hoisted to run exactly
// once up front; OMO_SKIP_MATERIALIZE=1 makes the downstream copies inside codex-plugin and
// shared-skills-assets no-ops, avoiding a git submodule index.lock and torn writes.
//
// The graph itself, its dependency edges and the consumer profiles live in build-nodes.ts so
// they can be inspected without running a build.
const nodes: BuildNode[] = selectBuildNodes(BUILD_NODES, process.env.OMO_BUILD_PROFILE)

async function run() {
	const profile = process.env.OMO_BUILD_PROFILE;
	if (profile) process.stdout.write(`build: profile ${profile} selected ${nodes.length} of ${BUILD_NODES.length} nodes\n`);
	await materializeOnce();
	const childEnv = { ...process.env, OMO_SKIP_MATERIALIZE: "1" };
	await runGraph(nodes, childEnv);
	process.stdout.write("build: all steps completed\n");
}

async function materializeOnce() {
	await runNode({ id: "materialize", command: "bun", args: ["run", "build:materialize-frontend"], deps: [] }, process.env);
}

async function runGraph(graph: BuildNode[], env: NodeJS.ProcessEnv) {
	const done = new Set<string>();
	const running = new Map<string, Promise<void>>();
	const limit = Math.max(1, availableParallelism());
	const pending = new Set(graph.map((node) => node.id));
	const byId = new Map(graph.map((node) => [node.id, node]));
	const liveChildren = new Set<ReturnType<typeof spawn>>();

	try {
		while (done.size < graph.length) {
			for (const id of pending) {
				if (running.size >= limit) break;
				const node = byId.get(id);
				if (!node) continue;
				if (!node.deps.every((dep) => done.has(dep))) continue;
				pending.delete(id);
				running.set(id, runNode(node, env, liveChildren).then(() => {
					running.delete(id);
					done.add(id);
				}));
			}
			if (running.size === 0) {
				throw new Error(`build: dependency cycle or unresolved deps among ${[...pending].join(", ")}`);
			}
			await Promise.race(running.values());
		}
	} catch (error) {
		// First failure aborts the build; SIGKILL each still-running step's whole process group
		// so it (and its grandchildren) stops immediately instead of holding the build open until
		// a slow sibling finishes.
		for (const child of liveChildren) {
			killTree(child);
		}
		await Promise.allSettled(running.values());
		throw error;
	}
}

const MAX_RETAINED_OUTPUT_BYTES = 1024 * 1024;

// Buffers each child's stdout/stderr (tail-capped to keep memory bounded on verbose parallel
// runs) and flushes it as one contiguous block so concurrent steps never interleave, keeping a
// failing step's output readable. Any non-zero exit rejects, which aborts the build with a
// non-zero code and a named error.
function runNode(node: BuildNode, env: NodeJS.ProcessEnv, liveChildren?: Set<ReturnType<typeof spawn>>): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(node.command, node.args, {
			cwd: repoRoot,
			env,
			shell: isWindows,
			// POSIX: lead a new process group so killTree can SIGKILL the whole subtree on abort.
			// Windows has no process groups; taskkill /T handles the tree there.
			detached: !isWindows,
			stdio: ["ignore", "pipe", "pipe"],
		});
		liveChildren?.add(child);
		let settled = false;
		const chunks: Buffer[] = [];
		let retainedBytes = 0;
		const retain = (chunk: Buffer) => {
			chunks.push(chunk);
			retainedBytes += chunk.length;
			while (retainedBytes > MAX_RETAINED_OUTPUT_BYTES && chunks.length > 1) {
				const dropped = chunks.shift();
				if (dropped !== undefined) retainedBytes -= dropped.length;
			}
		};
		child.stdout.on("data", retain);
		child.stderr.on("data", retain);
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			liveChildren?.delete(child);
			reject(error);
		});
		child.on("close", (status, signal) => {
			if (settled) return;
			settled = true;
			liveChildren?.delete(child);
			const output = Buffer.concat(chunks).toString("utf8");
			process.stdout.write(`build:${node.id}\n${output}`);
			if (status === 0) {
				resolve();
				return;
			}
			const reason = signal ? `signal ${signal}` : `exit code ${status}`;
			reject(new Error(`build:${node.id} failed with ${reason}`));
		});
	});
}

try {
	await run();
} catch (error) {
	// Parallel waves interleave sub-build output, so print the failing step as the last
	// stdout line before exiting non-zero to keep CI failure attribution fast.
	const message = error instanceof Error ? error.message : String(error);
	process.stdout.write(`build: FAILED: ${message}\n`);
	process.exit(1);
}
