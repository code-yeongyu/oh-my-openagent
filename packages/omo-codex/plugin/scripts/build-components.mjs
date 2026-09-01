#!/usr/bin/env node
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workspaces = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
const workspaceSet = new Set(workspaces);
const builtinModuleNames = new Set(builtinModules.filter((moduleName) => !moduleName.startsWith("_")));

const workspaceComponents = [];
for (const workspace of workspaces) {
	if (typeof workspace !== "string" || !workspace.startsWith("components/")) continue;
	if (!(await hasBuildScript(workspace))) continue;
	workspaceComponents.push({
		componentPath: workspace,
		buildCommand: "npm",
		buildArgs: ["run", "--workspace", workspace, "build"],
		buildCwd: root,
	});
}

const standaloneComponents = [];
for (const componentName of await readStandaloneComponentNames()) {
	const componentPath = `components/${componentName}`;
	if (!(await hasBuildScript(componentPath))) continue;
	standaloneComponents.push({
		componentPath,
		buildCommand: "npm",
		buildArgs: ["run", "build"],
		buildCwd: join(root, componentPath),
	});
}

const tasks = [...workspaceComponents, ...standaloneComponents];
const concurrency = Math.max(1, Math.min(tasks.length, availableParallelism()));
await runTasksWithConcurrency(tasks, concurrency);

async function runTasksWithConcurrency(items, limit) {
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (true) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) return;
			await buildComponent(items[index]);
		}
	});
	await Promise.all(workers);
}

async function buildComponent(task) {
	await runCaptured(task.buildCommand, task.buildArgs, task.buildCwd, `Building ${task.componentPath}`);
	if (await hasComponentOwnedBundle(task.componentPath)) return;
	await bundleCli(task.componentPath);
}

async function readStandaloneComponentNames() {
	const entries = await readdir(join(root, "components"), { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && !workspaceSet.has(`components/${entry.name}`))
		.map((entry) => entry.name)
		.sort();
}

async function hasBuildScript(relativePath) {
	let manifest;
	try {
		manifest = JSON.parse(await readFile(join(root, relativePath, "package.json"), "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
	return typeof manifest.scripts?.build === "string";
}

async function bundleCli(workspace) {
	const entry = join(root, workspace, "src", "cli.ts");
	const output = join(root, workspace, "dist", "cli.js");
	await runCaptured("bun", ["build", entry, "--target", "node", "--format", "esm", "--outfile", output], root, `Bundling ${workspace}/dist/cli.js`);
	await normalizeBuiltinImports(output);
}

async function hasComponentOwnedBundle(workspace) {
	try {
		const manifest = JSON.parse(await readFile(join(root, workspace, "dist", ".omo-runtime-manifest.json"), "utf8"));
		const cli = await stat(join(root, workspace, "dist", "cli.js"));
		return manifest?.schemaVersion === 1 && cli.isFile() && cli.size > 0;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

// Buffers each child's stdout/stderr and flushes it as one contiguous block so
// concurrent builds never interleave, keeping a failing component's output readable.
function runCaptured(command, args, cwd, label) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			shell: process.platform === "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const chunks = [];
		child.stdout.on("data", (chunk) => chunks.push(chunk));
		child.stderr.on("data", (chunk) => chunks.push(chunk));
		child.on("error", (error) => reject(error));
		child.on("close", (status, signal) => {
			const output = Buffer.concat(chunks).toString("utf8");
			process.stdout.write(`${label}\n${output}`);
			if (status === 0) {
				resolve();
				return;
			}
			const reason = signal ? `signal ${signal}` : `exit code ${status}`;
			const error = new Error(`${label} failed with ${reason}`);
			error.exitCode = status ?? 1;
			reject(error);
		});
	});
}

async function normalizeBuiltinImports(output) {
	const bundled = await readFile(output, "utf8");
	const normalized = bundled.replace(/(from\s+["']|import\s*\(\s*["'])([^"']+)(["'])/g, (match, prefix, specifier, suffix) => {
		if (specifier.startsWith("node:")) return match;
		if (!builtinModuleNames.has(specifier)) return match;
		return `${prefix}node:${specifier}${suffix}`;
	});
	if (normalized !== bundled) {
		await writeFile(output, normalized);
	}
}
