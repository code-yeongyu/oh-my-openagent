// Live-surface driver for #6131: drives the production `omo-lsp mcp` stdio server
// (packages/lsp-tools-mcp/src/cli.ts) against a REAL marksman language server in an
// isolated workspace + isolated user LSP config, and records the observed
// lsp_diagnostics result for a clean README.md.
//
// Usage: bun .omo/evidence/20260716-fix-6131/live-mcp-driver.mts <repoRoot> <marksmanExe>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [repoRoot, marksmanExe] = process.argv.slice(2);
if (!repoRoot || !marksmanExe) {
	console.error("usage: bun live-mcp-driver.mts <repoRoot> <marksmanExe>");
	process.exit(2);
}

const workspace = mkdtempSync(join(tmpdir(), "omo-6131-live-"));
const readme = join(workspace, "README.md");
writeFileSync(readme, "# Clean Document\n\nThis file has no diagnostics.\n", "utf-8");

const userConfig = join(workspace, "lsp-client.json");
writeFileSync(
	userConfig,
	JSON.stringify({ lsp: { markdown: { command: [marksmanExe, "server"], extensions: [".md"] } } }),
	"utf-8",
);

const child = spawn("bun", [join(repoRoot, "packages/lsp-tools-mcp/src/cli.ts"), "mcp"], {
	cwd: workspace,
	env: { ...process.env, LSP_TOOLS_MCP_USER_CONFIG: userConfig },
	stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map<number, (value: unknown) => void>();
child.stdout.on("data", (chunk: Buffer) => {
	buffer += chunk.toString("utf-8");
	for (;;) {
		const newline = buffer.indexOf("\n");
		if (newline === -1) return;
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		const message = JSON.parse(line) as { id?: number; result?: unknown };
		if (message.id !== undefined && pending.has(message.id)) {
			pending.get(message.id)?.(message.result);
			pending.delete(message.id);
		}
	}
});
child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[server] ${chunk}`));

let nextId = 1;
function request(method: string, params: unknown): Promise<unknown> {
	const id = nextId++;
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	return new Promise((resolve) => pending.set(id, resolve));
}
function notify(method: string, params: unknown): void {
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

const init = await request("initialize", {
	protocolVersion: "2024-11-05",
	capabilities: {},
	clientInfo: { name: "omo-6131-live-driver", version: "1.0.0" },
});
console.log(`initialize: ${JSON.stringify((init as { serverInfo?: unknown })?.serverInfo ?? init)}`);
notify("notifications/initialized", {});

console.log(`workspace: ${workspace}`);
console.log(`marksman: ${marksmanExe}`);
const startedAt = Date.now();
const result = await request("tools/call", {
	name: "lsp_diagnostics",
	arguments: { filePath: readme },
});
console.log(`elapsedMs: ${Date.now() - startedAt}`);
console.log(`lsp_diagnostics result:\n${JSON.stringify(result, null, 2)}`);

child.kill();
process.exit(0);
