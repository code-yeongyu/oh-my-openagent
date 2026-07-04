import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { callToolViaDaemon } from "../src/daemon-client.js";
import { type DaemonPaths, daemonPaths } from "../src/paths.js";
import { createLineDecoder, encodeJsonLine } from "../src/socket-jsonrpc.js";

const tempDirectories: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPaths(): DaemonPaths {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-retry-"));
	tempDirectories.push(dir);
	return daemonPaths({ CODEX_LSP_DAEMON_DIR: dir }, "test");
}

describe("daemon-client retry discipline", () => {
	it("#given a server that never answers in time #when the call times out #then the request is executed exactly once", async () => {
		const paths = tempPaths();
		mkdirSync(paths.dir, { recursive: true });

		let requestCount = 0;
		const server = createServer((socket) => {
			const decoder = createLineDecoder(() => {
				requestCount += 1;
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon("status", {}, {
			paths,
			ensure: async () => {},
			requestTimeoutMs: 100,
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("daemon request timed out");

		await new Promise<void>((resolve) => setTimeout(resolve, 300));
		expect(requestCount).toBe(1);
	});

	it("#given the socket appears only after the first connect failure #when retrying #then the second attempt succeeds with one delivered request", async () => {
		const paths = tempPaths();
		mkdirSync(paths.dir, { recursive: true });

		let requestCount = 0;
		let ensureCallCount = 0;

		const server = createServer((socket) => {
			const decoder = createLineDecoder(() => {
				requestCount += 1;
				socket.write(
					encodeJsonLine({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } }),
				);
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);

		const ensure = async (): Promise<void> => {
			ensureCallCount += 1;
			if (ensureCallCount === 1) return;
			await new Promise<void>((resolve) => server.listen(paths.socket, resolve));
		};

		const result = await callToolViaDaemon("status", {}, {
			paths,
			ensure,
			requestTimeoutMs: 2000,
		});

		expect(result.content[0]?.text).toBe("ok");
		expect(requestCount).toBe(1);
	});

	it("#given the server closes the connection after reading the request #then no retry happens", async () => {
		const paths = tempPaths();
		mkdirSync(paths.dir, { recursive: true });

		let requestCount = 0;
		const server = createServer((socket) => {
			const decoder = createLineDecoder(() => {
				requestCount += 1;
				socket.destroy();
			});
			socket.on("data", (chunk) => decoder.push(chunk));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(paths.socket, resolve));

		const result = await callToolViaDaemon("status", {}, {
			paths,
			ensure: async () => {},
			requestTimeoutMs: 2000,
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("daemon connection closed");
		expect(requestCount).toBe(1);
	});
});
