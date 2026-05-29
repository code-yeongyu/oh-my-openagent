#!/usr/bin/env node
// Vendors the monorepo MCP servers (ast-grep, lsp) and the self-contained lsp
// component hook into the omo-claude (Claude Code) plugin tree so the plugin is
// runnable standalone from a cache (no `../` traversal, no node_modules dance).
//
// What it produces (per plan decision D7/D12):
//   plugin/mcp/ast-grep/cli.js   the bun-bundled ast-grep MCP server entry
//                                (single file, node-builtins only; the `sg`
//                                binary is resolved from the host at run time).
//   plugin/mcp/lsp/**            the entire lsp-tools-mcp `dist/` tree (cli.js +
//                                its relative siblings; node-builtins only).
//   components/lsp/dist/cli.js   the lsp component hook re-bundled with its
//                                `@code-yeongyu/lsp-tools-mcp` dependency inlined
//                                so the hook boots from a tree with NO
//                                node_modules.
//
// Modes:
//   node sync-mcp.mjs              build the MCP packages, then vendor + bundle.
//   node sync-mcp.mjs --no-build   vendor + bundle from already-built dist.
//   node sync-mcp.mjs --check      assert the vendored artifacts exist and that
//                                  .mcp.json is self-contained (no `../`,
//                                  references ${CLAUDE_PLUGIN_ROOT}); exit
//                                  nonzero on any failure. Does not write.
//
// Path resolution mirrors sync-components.mjs / sync-skills.mjs: every root is
// derived from import.meta.url so the script is location-stable.

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(SCRIPT_DIR);
const PACKAGE_ROOT = dirname(PLUGIN_ROOT);
const PACKAGES_ROOT = dirname(PACKAGE_ROOT);

export const AST_GREP_PACKAGE_ROOT = join(PACKAGES_ROOT, "ast-grep-mcp");
export const LSP_TOOLS_PACKAGE_ROOT = join(PACKAGES_ROOT, "lsp-tools-mcp");

export const MCP_DEST_ROOT = join(PLUGIN_ROOT, "mcp");
export const AST_GREP_DEST = join(MCP_DEST_ROOT, "ast-grep");
export const LSP_DEST = join(MCP_DEST_ROOT, "lsp");

export const LSP_COMPONENT_HOOK = join(PLUGIN_ROOT, "components", "lsp", "dist", "cli.js");
export const MCP_JSON_PATH = join(PLUGIN_ROOT, ".mcp.json");

// Files the boot path of each vendored server actually needs at run time.
const REQUIRED_AST_GREP_FILES = ["cli.js"];
const REQUIRED_LSP_FILES = ["cli.js", "mcp.js", "tools.js", join("lsp", "manager.js")];

async function pathExists(target) {
	try {
		await stat(target);
		return true;
	} catch (error) {
		if (error && error.code === "ENOENT") return false;
		throw error;
	}
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit", encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed in ${cwd} (exit ${result.status})`);
	}
}

// Bundle a node entry into a single self-contained file with `bun build`.
function bundle(entry, outfile) {
	run("bun", ["build", entry, "--target=node", "--format=esm", "--outfile", outfile], PLUGIN_ROOT);
}

export async function buildMcpPackages() {
	// ast-grep-mcp: bun-bundled single-file CLI (workspace deps inlined).
	run("bun", ["run", "build"], AST_GREP_PACKAGE_ROOT);
	// lsp-tools-mcp: tsc to dist/ (node-builtins-only runtime).
	run("npm", ["run", "build"], LSP_TOOLS_PACKAGE_ROOT);
}

export async function vendorMcp() {
	await rm(MCP_DEST_ROOT, { recursive: true, force: true });
	await mkdir(MCP_DEST_ROOT, { recursive: true });

	// ast-grep: the built cli.js is a self-contained bundle (node-builtins only;
	// the `sg`/`ast-grep` binary is located on the host at run time). Vendor the
	// single file — do NOT ship the ~46MB platform-specific binary.
	await mkdir(AST_GREP_DEST, { recursive: true });
	await cp(join(AST_GREP_PACKAGE_ROOT, "dist", "cli.js"), join(AST_GREP_DEST, "cli.js"));

	// lsp: the whole dist/ tree (cli.js imports ./mcp.js + ./lsp/manager.js
	// relatively; the closure imports only node builtins). Copy it verbatim so
	// the relative imports resolve from the cache.
	await mkdir(LSP_DEST, { recursive: true });
	await cp(join(LSP_TOOLS_PACKAGE_ROOT, "dist"), LSP_DEST, { recursive: true });
}

// Re-bundle the lsp COMPONENT hook with its @code-yeongyu/lsp-tools-mcp
// dependency inlined so `node components/lsp/dist/cli.js hook post-tool-use`
// boots from a tree with NO node_modules. The tsc-built dist/cli.js imports the
// bare specifier "@code-yeongyu/lsp-tools-mcp/dist/*.js" which is unresolvable in
// a plugin cache; bundling inlines it (result: node-builtins only).
export async function bundleLspComponentHook() {
	if (!(await pathExists(LSP_COMPONENT_HOOK))) {
		// A prior component sync can wipe components/lsp/dist; rebuild it before bundling.
		run("npm", ["run", "build", "--workspace", "components/lsp"], PLUGIN_ROOT);
	}
	const tmp = `${LSP_COMPONENT_HOOK}.bundle.mjs`;
	bundle(LSP_COMPONENT_HOOK, tmp);
	await rm(LSP_COMPONENT_HOOK, { force: true });
	await cp(tmp, LSP_COMPONENT_HOOK);
	await rm(tmp, { force: true });
}

export async function checkVendored() {
	const problems = [];

	for (const rel of REQUIRED_AST_GREP_FILES) {
		if (!(await pathExists(join(AST_GREP_DEST, rel)))) {
			problems.push(`missing plugin/mcp/ast-grep/${rel}`);
		}
	}
	for (const rel of REQUIRED_LSP_FILES) {
		if (!(await pathExists(join(LSP_DEST, rel)))) {
			problems.push(`missing plugin/mcp/lsp/${rel}`);
		}
	}

	if (!(await pathExists(MCP_JSON_PATH))) {
		problems.push("missing plugin/.mcp.json");
	} else {
		const raw = await readFile(MCP_JSON_PATH, "utf8");
		if (raw.includes("../")) problems.push(".mcp.json contains a '../' path");
		if (!raw.includes("${CLAUDE_PLUGIN_ROOT}")) {
			problems.push(".mcp.json does not reference ${CLAUDE_PLUGIN_ROOT}");
		}
		if (raw.includes('"cwd"')) problems.push('.mcp.json still declares a "cwd"');
		const parsed = JSON.parse(raw);
		const servers = parsed.mcpServers ?? {};
		for (const name of ["ast_grep", "lsp"]) {
			if (!servers[name]) problems.push(`.mcp.json missing mcpServers.${name}`);
		}
	}

	// The hook must be self-contained: no UNBUNDLED bare import/require of
	// lsp-tools-mcp. A `require.resolve(...)` is allowed as the monorepo/dev
	// fallback guarded by CLAUDE_PLUGIN_ROOT (the vendored mcp/lsp/cli.js path is
	// used in a cache), so it never executes from a node_modules-free tree.
	if (await pathExists(LSP_COMPONENT_HOOK)) {
		const hook = await readFile(LSP_COMPONENT_HOOK, "utf8");
		const unbundledImport =
			/\bfrom\s*["'][^"']*@code-yeongyu\/lsp-tools-mcp|\brequire\s*\(\s*["'][^"']*@code-yeongyu\/lsp-tools-mcp/;
		if (unbundledImport.test(hook)) {
			problems.push("components/lsp/dist/cli.js still has an unbundled @code-yeongyu/lsp-tools-mcp import");
		}
	} else {
		problems.push("missing components/lsp/dist/cli.js");
	}

	return problems;
}

export async function syncMcp(options = {}) {
	const build = options.build ?? true;
	if (build) await buildMcpPackages();
	await vendorMcp();
	await bundleLspComponentHook();
}

async function main() {
	const args = process.argv.slice(2);
	const check = args.includes("--check");
	const noBuild = args.includes("--no-build");

	if (check) {
		const problems = await checkVendored();
		if (problems.length > 0) {
			console.error("MCP vendoring out of sync:");
			for (const line of problems) console.error(`  - ${line}`);
			process.exitCode = 1;
			return;
		}
		console.log("MCP vendoring in sync (ast-grep + lsp servers + lsp hook)");
		return;
	}

	await syncMcp({ build: !noBuild });
	console.log("vendored MCP servers: ast-grep, lsp; bundled lsp component hook");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
