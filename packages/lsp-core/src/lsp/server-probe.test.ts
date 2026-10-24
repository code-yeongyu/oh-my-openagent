import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { LSP_PROBE_FIXTURES, probeLspServer } from "./server-probe.js";
import type { ResolvedServer } from "./types.js";

const PROBE_SERVER = join(import.meta.dir, "fixtures", "probe-server.mjs");
const FIXTURE = LSP_PROBE_FIXTURES["typescript"];

function fakeServer(mode: string): ResolvedServer {
	return { id: "fake", command: [process.execPath, PROBE_SERVER, mode], extensions: [".ts"], priority: 0 };
}

describe("probeLspServer", () => {
	if (FIXTURE === undefined) throw new Error("typescript fixture missing");

	test("#given a working server #when probed #then reports ok with the symbol count", async () => {
		// when
		const result = await probeLspServer(fakeServer("ok"), FIXTURE, { diagnosticsWindowMs: 50 });

		// then
		expect(result.status).toBe("ok");
		if (result.status === "ok") expect(result.symbols).toBe(1);
	});

	test("#given a temp root reached through a symlink (macOS /var) #when probed #then the server is asked about the URI it opened", async () => {
		// given
		const realRoot = mkdtempSync(join(tmpdir(), "omo-probe-real-"));
		const linkedRoot = `${realRoot}-link`;
		symlinkSync(realRoot, linkedRoot);

		try {
			// when
			const result = await probeLspServer(fakeServer("ok"), FIXTURE, { diagnosticsWindowMs: 50, symbolsWindowMs: 300, tempRoot: linkedRoot });

			// then
			expect(result.status).toBe("ok");
		} finally {
			rmSync(linkedRoot, { force: true });
			rmSync(realRoot, { recursive: true, force: true });
		}
	});

	test("#given a server that exits at once #when probed #then reports startup_failed", async () => {
		// when
		const result = await probeLspServer(fakeServer("exit"), FIXTURE);

		// then
		expect(result.status).toBe("startup_failed");
	});

	test("#given a missing executable #when probed #then reports startup_failed at spawn or initialize", async () => {
		// given
		const server: ResolvedServer = { id: "ghost", command: ["/nonexistent/ghost-ls"], extensions: [".ts"], priority: 0 };

		// when
		const result = await probeLspServer(server, FIXTURE, { initializeTimeoutMs: 2_000 });

		// then
		expect(result.status).toBe("startup_failed");
	});

	test("#given a server that never answers initialize #when probed #then reports a timeout at initialize", async () => {
		// when
		const result = await probeLspServer(fakeServer("hang-initialize"), FIXTURE, { initializeTimeoutMs: 300 });

		// then
		expect(result.status).toBe("timeout");
		if (result.status !== "ok") expect(result.stage).toBe("initialize");
	});

	test("#given a server that parses the fixture only after didOpen settles #when probed #then retries and reports ok", async () => {
		// when
		const result = await probeLspServer(fakeServer("late-symbols"), FIXTURE, { diagnosticsWindowMs: 50 });

		// then
		expect(result.status).toBe("ok");
		if (result.status === "ok") expect(result.symbols).toBe(1);
	});

	test("#given a server that answers without parsing the fixture #when probed #then reports request_failed", async () => {
		// when
		const result = await probeLspServer(fakeServer("empty-symbols"), FIXTURE, { symbolsWindowMs: 300 });

		// then
		expect(result.status).toBe("request_failed");
		if (result.status !== "ok") expect(result.detail).toContain("no symbols");
	});

	test("#given a server whose documentSymbol fails #when probed #then reports request_failed", async () => {
		// when
		const result = await probeLspServer(fakeServer("symbol-error"), FIXTURE);

		// then
		expect(result.status).toBe("request_failed");
		if (result.status !== "ok") expect(result.detail).toContain("symbol provider crashed");
	});
});
