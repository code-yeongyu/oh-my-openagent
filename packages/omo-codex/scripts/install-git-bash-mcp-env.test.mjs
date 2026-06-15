import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stampGitBashMcpEnv } from "./install-dist/install-local.mjs";

const MANIFEST = `${JSON.stringify(
	{
		mcpServers: {
			ast_grep: { command: "node", args: ["../../ast-grep-mcp/dist/cli.js", "mcp"] },
			git_bash: { command: "node", args: ["../../git-bash-mcp/dist/cli.js", "mcp"] },
		},
	},
	null,
	"\t",
)}\n`;

async function createPluginRoot() {
	const pluginRoot = await mkdtemp(join(tmpdir(), "git-bash-mcp-env-"));
	await writeFile(join(pluginRoot, ".mcp.json"), MANIFEST);
	return pluginRoot;
}

test("#given win32 install with OMO_CODEX_GIT_BASH_PATH set #when stamping #then git_bash server env forwards the override", async (t) => {
	const pluginRoot = await createPluginRoot();
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	const changed = await stampGitBashMcpEnv({
		pluginRoot,
		env: { OMO_CODEX_GIT_BASH_PATH: "D:\\Git\\bin\\bash.exe" },
		platform: "win32",
	});

	assert.equal(changed, true);
	const parsed = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
	assert.deepEqual(parsed.mcpServers.git_bash.env, { OMO_CODEX_GIT_BASH_PATH: "D:\\Git\\bin\\bash.exe" });
	assert.equal(parsed.mcpServers.ast_grep.env, undefined);
});

test("#given the override is unset #when stamping #then the manifest stays byte-identical", async (t) => {
	const pluginRoot = await createPluginRoot();
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	const changed = await stampGitBashMcpEnv({ pluginRoot, env: {}, platform: "win32" });

	assert.equal(changed, false);
	assert.equal(await readFile(join(pluginRoot, ".mcp.json"), "utf8"), MANIFEST);
});

test("#given a non-Windows install #when stamping #then the manifest stays byte-identical", async (t) => {
	const pluginRoot = await createPluginRoot();
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));

	const changed = await stampGitBashMcpEnv({
		pluginRoot,
		env: { OMO_CODEX_GIT_BASH_PATH: "D:\\Git\\bin\\bash.exe" },
		platform: "darwin",
	});

	assert.equal(changed, false);
	assert.equal(await readFile(join(pluginRoot, ".mcp.json"), "utf8"), MANIFEST);
});

test("#given the override already stamped #when stamping again #then nothing changes", async (t) => {
	const pluginRoot = await createPluginRoot();
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));
	const input = { pluginRoot, env: { OMO_CODEX_GIT_BASH_PATH: "D:\\Git\\bin\\bash.exe" }, platform: "win32" };

	await stampGitBashMcpEnv(input);
	const afterFirst = await readFile(join(pluginRoot, ".mcp.json"), "utf8");
	const changedAgain = await stampGitBashMcpEnv(input);

	assert.equal(changedAgain, false);
	assert.equal(await readFile(join(pluginRoot, ".mcp.json"), "utf8"), afterFirst);
});

test("#given a manifest without a git_bash server #when stamping #then the manifest stays byte-identical", async (t) => {
	const pluginRoot = await mkdtemp(join(tmpdir(), "git-bash-mcp-env-"));
	t.after(() => rm(pluginRoot, { recursive: true, force: true }));
	const manifest = `${JSON.stringify({ mcpServers: { ast_grep: { command: "node" } } }, null, "\t")}\n`;
	await writeFile(join(pluginRoot, ".mcp.json"), manifest);

	const changed = await stampGitBashMcpEnv({
		pluginRoot,
		env: { OMO_CODEX_GIT_BASH_PATH: "D:\\Git\\bin\\bash.exe" },
		platform: "win32",
	});

	assert.equal(changed, false);
	assert.equal(await readFile(join(pluginRoot, ".mcp.json"), "utf8"), manifest);
});
