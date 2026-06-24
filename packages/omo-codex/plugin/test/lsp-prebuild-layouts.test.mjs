import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_SCRIPTS = fileURLToPath(new URL("../components/lsp/scripts", import.meta.url));
const BUILD_LSP_TOOLS = join(REPO_SCRIPTS, "build-lsp-tools.mjs");
const BUILD_LSP_DAEMON = join(REPO_SCRIPTS, "build-lsp-daemon.mjs");

// Run a copied script (built from HEAD sources) and return { status, stdout, stderr }.
// execFileSync throws on non-zero exit; we capture the SpawnError fields instead.
function runScript(script, cwd) {
	try {
		const stdout = execFileSync(process.execPath, [script], { cwd, encoding: "utf8" });
		return { status: 0, stdout, stderr: "" };
	} catch (err) {
		return {
			status: typeof err.status === "number" ? err.status : 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

// Escape a string for use in a RegExp literal.
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("#given the installed cache layout #when running build-lsp-tools #then uses the bundled dist and exits 0", async () => {
	// given — mirror the installed plugin cache: scripts 2-up from components/lsp-tools-mcp/dist
	const root = await mkdtemp(join(tmpdir(), "lsp-prebuild-cache-tools-"));
	try {
		const scriptsDir = join(root, "components", "lsp", "scripts");
		await mkdir(scriptsDir, { recursive: true });
		await copyFile(BUILD_LSP_TOOLS, join(scriptsDir, "build-lsp-tools.mjs"));

		await mkdir(join(root, "components", "lsp-tools-mcp", "dist", "lsp"), { recursive: true });
		await writeFile(join(root, "components", "lsp-tools-mcp", "dist", "cli.js"), "");
		await writeFile(join(root, "components", "lsp-tools-mcp", "dist", "tools.js"), "");
		await writeFile(join(root, "components", "lsp-tools-mcp", "dist", "lsp", "manager.js"), "");

		// when
		const result = runScript(join(scriptsDir, "build-lsp-tools.mjs"), root);

		// then
		assert.equal(result.status, 0, `expected exit 0; stderr: ${result.stderr}`);
		assert.match(result.stdout, /Using bundled lsp-tools-mcp dist/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("#given the installed cache layout #when running build-lsp-daemon #then uses the bundled dist and exits 0", async () => {
	// given — mirror the installed plugin cache: scripts 2-up from components/lsp-daemon/dist
	const root = await mkdtemp(join(tmpdir(), "lsp-prebuild-cache-daemon-"));
	try {
		const scriptsDir = join(root, "components", "lsp", "scripts");
		await mkdir(scriptsDir, { recursive: true });
		await copyFile(BUILD_LSP_DAEMON, join(scriptsDir, "build-lsp-daemon.mjs"));

		await mkdir(join(root, "components", "lsp-daemon", "dist"), { recursive: true });
		await writeFile(join(root, "components", "lsp-daemon", "dist", "cli.js"), "");
		await writeFile(join(root, "components", "lsp-daemon", "dist", "index.js"), "");
		await writeFile(join(root, "components", "lsp-daemon", "dist", "index.d.ts"), "");

		// when
		const result = runScript(join(scriptsDir, "build-lsp-daemon.mjs"), root);

		// then
		assert.equal(result.status, 0, `expected exit 0; stderr: ${result.stderr}`);
		assert.match(result.stdout, /Using bundled lsp-daemon dist/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("#given neither layout #when running build-lsp-tools #then fails listing every probed path", async () => {
	// given — bare layout: only the script, no package.json anywhere, no dist outputs
	const root = await mkdtemp(join(tmpdir(), "lsp-prebuild-none-"));
	try {
		const scriptsDir = join(root, "components", "lsp", "scripts");
		await mkdir(scriptsDir, { recursive: true });
		await copyFile(BUILD_LSP_TOOLS, join(scriptsDir, "build-lsp-tools.mjs"));

		// when
		const result = runScript(join(scriptsDir, "build-lsp-tools.mjs"), root);

		// then — exit 1, stderr enumerates BOTH probed package.json paths
		// candidate 1: 5-up repo sibling (resolves outside the temp tree)
		const candidate1PkgJson = join(scriptsDir, "..", "..", "..", "..", "..", "lsp-tools-mcp", "package.json");
		// candidate 2: 2-up components sibling (inside the temp tree)
		const candidate2PkgJson = join(root, "components", "lsp-tools-mcp", "package.json");

		assert.equal(result.status, 1);
		assert.match(result.stderr, new RegExp(escapeRegex(candidate1PkgJson)));
		assert.match(result.stderr, new RegExp(escapeRegex(candidate2PkgJson)));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("#given the repo sibling layout with fresh outputs #when running build-lsp-tools #then exits 0 without building", async () => {
	// given — simulate the repo layout: script at d1/d2/d3/components/lsp/scripts/,
	// lsp-tools-mcp at d1/ (5-up from the scripts dir), outputs newer than package.json
	const root = await mkdtemp(join(tmpdir(), "lsp-prebuild-repo-"));
	try {
		const scriptsDir = join(root, "d1", "d2", "d3", "components", "lsp", "scripts");
		await mkdir(scriptsDir, { recursive: true });
		await copyFile(BUILD_LSP_TOOLS, join(scriptsDir, "build-lsp-tools.mjs"));

		// 5-up from scriptsDir lands on join(root, "d1")
		const lspToolsDir = join(root, "d1", "lsp-tools-mcp");
		await mkdir(join(lspToolsDir, "dist", "lsp"), { recursive: true });

		// package.json gets an older mtime
		await writeFile(join(lspToolsDir, "package.json"), "{}");
		const older = new Date("2025-01-01T00:00:00.000Z");
		await utimes(join(lspToolsDir, "package.json"), older, older);

		// outputs get a newer mtime — isBuildFresh returns true
		const newer = new Date("2025-01-02T00:00:00.000Z");
		for (const rel of ["dist/cli.js", "dist/tools.js", "dist/lsp/manager.js"]) {
			await writeFile(join(lspToolsDir, rel), "");
			await utimes(join(lspToolsDir, rel), newer, newer);
		}

		// when
		const result = runScript(join(scriptsDir, "build-lsp-tools.mjs"), root);

		// then — exits 0 immediately (fresh build), no npm invocation
		assert.equal(result.status, 0, `expected exit 0; stderr: ${result.stderr}`);
		assert.doesNotMatch(result.stdout, /Installing/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
