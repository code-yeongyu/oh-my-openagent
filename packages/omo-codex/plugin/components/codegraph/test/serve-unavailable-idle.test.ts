import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";

import { runUnavailableCodegraphMcpServer } from "../src/mcp-unavailable.ts";

describe("unavailable codegraph MCP idle teardown", () => {
	it("#given the codex host (no respawn for exited stdio servers) #when the unavailable stub starts #then the idle timeout is disabled", async () => {
		// given — codex never respawns a user-configured stdio MCP server
		// (codex-rs reconnects only its own codex_apps server), so if the stub
		// inherited the mcp-stdio-core default idle timeout it would destroy its
		// own stdin after 10 idle minutes and every later codegraph tool call in
		// a long-lived session would fail on a dead connection instead of
		// answering with the skip reason.
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		stdout.resume();
		const lifecycle: Array<{ readonly event: string; readonly data?: unknown }> = [];

		try {
			// when
			const served = runUnavailableCodegraphMcpServer({
				input: stdin,
				output: stdout,
				reason: "CodeGraph MCP skipped: test reason",
				serverVersion: "0.0.0-test",
				lifecycleLog: (event, data) => {
					lifecycle.push({ event, data });
				},
			});
			const outcome = await Promise.race([
				served.then(() => "settled" as const),
				Bun.sleep(500).then(() => "parked" as const),
			]);

			// then — the server must park on the held-open pipe (no idle timer
			// tore it down) and must have started with the timeout disabled.
			expect(outcome).toBe("parked");
			expect(lifecycle).toContainEqual({
				event: "stdio_started",
				data: expect.objectContaining({ idle_timeout_ms: 0 }),
			});
		} finally {
			stdin.destroy();
			stdout.destroy();
		}
	});
});
