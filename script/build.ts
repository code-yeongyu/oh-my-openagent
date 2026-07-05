#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Every node writes to a disjoint output path, so ordering only matters where one node
// reads another's output. The three real edges: index -> node-require-shim (patches
// dist/index.js), materialize -> skills-assets and materialize -> codex-plugin (both read
// the materialized packages/shared-skills/skills). materialize is hoisted to run exactly
// once up front; OMO_SKIP_MATERIALIZE=1 makes the downstream copies inside codex-plugin and
// shared-skills-assets no-ops, avoiding a git submodule index.lock and torn writes.
type BuildNode = {
	id: string;
	command: string;
	args: string[];
	deps: string[];
};

const OPENTUI_EXTERNALS = ["@opentui/core", "@opentui/keymap", "@opentui/solid"];

const nodes: BuildNode[] = [
	{ id: "git-bash-mcp", command: "bun", args: ["run", "build:git-bash-mcp"], deps: [] },
	{ id: "lsp-tools-mcp", command: "bun", args: ["run", "build:lsp-tools-mcp"], deps: [] },
	{ id: "lsp-daemon", command: "bun", args: ["run", "build:lsp-daemon"], deps: [] },
	{ id: "codex-plugin", command: "bun", args: ["run", "build:codex-plugin"], deps: [] },
	{ id: "senpi-plugin", command: "bun", args: ["run", "build:senpi-plugin"], deps: [] },
	{ id: "index", command: "bun", args: ["build", "packages/omo-opencode/src/index.ts", "--outdir", "dist", "--target", "bun", "--format", "esm", "--external", "zod"], deps: [] },
	{ id: "tui", command: "bun", args: ["build", "packages/omo-opencode/src/tui.ts", "--outdir", "dist", "--target", "bun", "--format", "esm", ...OPENTUI_EXTERNALS.flatMap((name) => ["--external", name])], deps: [] },
	{ id: "shared-skills-assets", command: "bun", args: ["run", "build:shared-skills-assets"], deps: [] },
	{ id: "node-require-shim", command: "bun", args: ["run", "build:node-require-shim"], deps: ["index"] },
	{ id: "declarations", command: "tsc", args: ["--emitDeclarationOnly"], deps: [] },
	{ id: "cli", command: "bun", args: ["build", "packages/omo-opencode/src/cli/index.ts", "--outdir", "dist/cli", "--target", "bun", "--format", "esm"], deps: [] },
	{ id: "cli-node", command: "bun", args: ["run", "build:cli-node"], deps: [] },
	{ id: "codex-install", command: "bun", args: ["run", "build:codex-install"], deps: [] },
	{ id: "schema", command: "bun", args: ["run", "build:schema"], deps: [] },
];

await run();

async function run() {
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

	while (done.size < graph.length) {
		for (const id of pending) {
			if (running.size >= limit) break;
			const node = byId.get(id);
			if (!node) continue;
			if (!node.deps.every((dep) => done.has(dep))) continue;
			pending.delete(id);
			running.set(id, runNode(node, env).then(() => {
				running.delete(id);
				done.add(id);
			}));
		}
		if (running.size === 0) {
			throw new Error(`build: dependency cycle or unresolved deps among ${[...pending].join(", ")}`);
		}
		await Promise.race(running.values());
	}
}

// Buffers each child's stdout/stderr and flushes it as one contiguous block so concurrent
// steps never interleave, keeping a failing step's output readable. Any non-zero exit
// rejects, which aborts the build with a non-zero code and a named error.
function runNode(node: BuildNode, env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(node.command, node.args, {
			cwd: repoRoot,
			env,
			shell: process.platform === "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const chunks: Buffer[] = [];
		child.stdout.on("data", (chunk) => chunks.push(chunk));
		child.stderr.on("data", (chunk) => chunks.push(chunk));
		child.on("error", (error) => reject(error));
		child.on("close", (status, signal) => {
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
