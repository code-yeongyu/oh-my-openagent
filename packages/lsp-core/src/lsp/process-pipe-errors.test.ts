import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const probePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "disposed-stdin-epipe-probe.ts");

describe("spawned LSP server pipes", () => {
	it("handles an EPIPE on server stdin after the connection is disposed", () => {
		// given a server whose JSON-RPC connection was disposed during cleanup
		// when its stdin pipe then fails with EPIPE (the Windows teardown order)
		const result = spawnSync(process.execPath, [probePath], { encoding: "utf8", timeout: 15_000 });

		// then the failure is reported as ignored cleanup noise, never raised as unhandled
		expect(result.stderr).not.toContain("Unhandled");
		expect(result.stderr).toContain("[lsp] ignored server stdin failure during cleanup: EPIPE");
		expect(result.stdout).toContain("PROBE_SURVIVED");
		expect(result.status).toBe(0);
	});
});
