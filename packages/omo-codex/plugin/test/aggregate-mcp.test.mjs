import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { exists, readJson, root } from "./aggregate-plugin-fixture.mjs";

const mcpPackageManifestPaths = ["../../lsp-tools-mcp/package.json", "../../git-bash-mcp/package.json"];
const mcpPackageManifestExists = await Promise.all(mcpPackageManifestPaths.map(exists));

test("#given aggregate MCP config #when inspected #then code MCPs reference package runtimes without package names", async () => {
	// given
	const packageJson = await readJson("package.json");
	const mcp = await readJson(".mcp.json");
	const lspSources = await readdir(join(root, "components", "lsp", "src"));
	const bundledMcpBuildScript = await readFile(join(root, "scripts", "build-bundled-mcp-runtimes.mjs"), "utf8");

	// when
	const lspServer = mcp.mcpServers.lsp;
	const gitBashServer = mcp.mcpServers.git_bash;
	const codegraphServer = mcp.mcpServers.codegraph;
	const codeMcpNames = Object.keys(mcp.mcpServers)
		.filter((name) => name === "lsp" || name === "git_bash" || name === "codegraph")
		.sort();
	const componentLocalMcpSources = lspSources.filter((name) => name.startsWith("lazy-mcp") || name === "lazy-lsp-mcp.ts");

	// then
	assert.deepEqual(codeMcpNames, ["codegraph", "git_bash", "lsp"]);
	assert.equal(packageJson.workspaces.includes("components/lsp/packages/lsp-tools-mcp"), false);
	assert.deepEqual(packageJson.dependencies, { "@oh-my-opencode/shared-skills": "file:../../shared-skills" });
	assert.doesNotMatch(bundledMcpBuildScript, new RegExp(["ast", "grep", "mcp"].join("-")));
	assert.match(bundledMcpBuildScript, /git-bash-mcp/);
	assert.doesNotMatch(packageJson.scripts.build, /--workspaces/);
	assert.equal(lspServer.command, "node");
	assert.deepEqual(lspServer.args, ["../../lsp-daemon/dist/cli.js", "mcp"]);
	assert.equal(lspServer.cwd, ".");
	assert.equal(Object.hasOwn(mcp.mcpServers, "ast_grep"), false);
	assert.equal(gitBashServer.command, "node");
	assert.deepEqual(gitBashServer.args, ["../../git-bash-mcp/dist/cli.js", "mcp"]);
	assert.equal(gitBashServer.cwd, ".");
	assert.equal(codegraphServer.command, "node");
	assert.deepEqual(codegraphServer.args, ["components/codegraph/dist/serve.js"]);
	assert.equal(codegraphServer.cwd, ".");
	assert.equal(codegraphServer.required, false);
	assert.deepEqual(componentLocalMcpSources, []);
});

test(
	"#given package-level MCP CLIs #when package metadata is inspected #then bin names use the omo prefix",
	{ skip: mcpPackageManifestExists.some((exists) => !exists) },
	async () => {
		// given
		const [lspPackageJson, gitBashPackageJson] = await Promise.all(
			mcpPackageManifestPaths.map((path) => readJson(path)),
		);

		// when
		const binNames = [
			...Object.keys(lspPackageJson.bin ?? {}),
			...Object.keys(gitBashPackageJson.bin ?? {}),
		].sort();

		// then
		assert.deepEqual(binNames, ["omo-git-bash", "omo-lsp"]);
		for (const name of binNames) {
			assert.match(name, /^omo-/);
		}
	},
);
