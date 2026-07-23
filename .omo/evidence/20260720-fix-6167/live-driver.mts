// Live-surface driver for issue #6167 (run with: bun .omo/evidence/20260720-fix-6167/live-driver.mts)
//
// Drives the REAL lsp-core LspClient over REAL JSON-RPC stdio against the REAL fixture LSP
// server, configured to publish textDocument/publishDiagnostics under a LOWERCASE Windows
// drive URI (file:///c:/...) exactly like PowerShell Editor Services does, while openByUri is
// keyed by pathToFileURL (file:///C:/...). Before the fix the diagnostics are dropped and
// client.diagnostics() returns a freshness timeout; after the fix they are delivered.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { LspClient } from "../../../packages/lsp-core/src/lsp/client.ts";

const fixtureServer = fileURLToPath(
	new URL("../../../packages/lsp-core/src/lsp/fixtures/workspace-edit-server.mjs", import.meta.url),
);

const workspace = mkdtempSync(join(tmpdir(), "omo-6167-drive-"));
const file = join(workspace, "gdrive-sync.ps1");
writeFileSync(file, "$value = 1\n", "utf-8");

const upperUri = pathToFileURL(realpathSync(file)).href; // openByUri key: file:///C:/...
const lowerUri = upperUri.replace(/^(file:\/\/\/)([A-Z]):/, (_m, scheme, drive) => `${scheme}${drive.toLowerCase()}:`);

const diagnostic = {
	range: { start: { line: 99, character: 4 }, end: { line: 99, character: 10 } },
	severity: 1,
	message: "Missing expression after unary operator '--'.",
};

const scenario = {
	// No diagnosticProvider capability => push-only fallback, exactly like PSES.
	publishDiagnostics: [{ trigger: "didOpen", uri: lowerUri, diagnostics: [diagnostic] }],
};
const scenarioPath = join(workspace, "scenario.json");
const eventsPath = join(workspace, "events.jsonl");
writeFileSync(scenarioPath, JSON.stringify(scenario), "utf-8");
writeFileSync(eventsPath, "", "utf-8");

const server = {
	id: "fake-pses",
	command: [process.env["NODE_BINARY"] ?? "node", fixtureServer, scenarioPath, eventsPath],
	extensions: [".ps1"],
	priority: 0,
};

const client = new LspClient(workspace, server as never, {
	diagnosticsFreshnessTimeoutMs: 1500,
	versionlessPublishQuiescenceMs: 5,
	requestTimeoutMs: 5000,
	initializeTimeoutMs: 5000,
});

console.log("openByUri store key (pathToFileURL):", upperUri);
console.log("server-published URI (PSES-style)  :", lowerUri);
try {
	await client.start();
	await client.initialize();
	const result = await client.diagnostics(file);
	console.log("diagnostics().items      =", JSON.stringify(result.items));
	console.log("diagnostics().transient  =", JSON.stringify(result.transientError ?? null));
	const delivered = result.items.length === 1 && result.transientError === undefined;
	console.log(delivered ? "RESULT: PASS - diagnostics delivered end-to-end" : "RESULT: FAIL - dropped -> freshness timeout");
	process.exitCode = delivered ? 0 : 1;
} finally {
	await client.stop();
	rmSync(workspace, { recursive: true, force: true });
}
