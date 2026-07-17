import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given aggregate MCP config #when inspected #then registers research MCPs without ast-grep MCP", async () => {
	// given
	const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"));

	// when
	const serverNames = Object.keys(mcp.mcpServers).sort();

	// then
	assert.deepEqual(serverNames, ["codegraph", "context7", "git_bash", "grep_app", "lsp"]);
	assert.equal(mcp.mcpServers.grep_app.url, "https://mcp.grep.app");
	assert.equal(mcp.mcpServers.context7.url, "https://mcp.context7.com/mcp");
	assert.equal(Object.hasOwn(mcp.mcpServers, "ast_grep"), false);
	assert.deepEqual(mcp.mcpServers.codegraph.args, ["components/codegraph/dist/serve.js"]);
	assert.equal(mcp.mcpServers.codegraph.required, false);
	assert.equal(mcp.mcpServers.lsp.startup_timeout_sec, 10);
});
