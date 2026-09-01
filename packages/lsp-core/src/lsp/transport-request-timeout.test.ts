import { PassThrough } from "node:stream";

import { describe, expect, it } from "bun:test";

import { ControlledClock } from "./controlled-clock-test-support.js";
import { LspRequestTimeoutError } from "./errors.js";
import { JsonRpcConnection } from "./json-rpc-connection.js";
import { LspClientTransport } from "./transport.js";
import type { LspClientTimeoutOptions } from "./transport.js";
import type { ResolvedServer } from "./types.js";

const fakeServer: ResolvedServer = {
	id: "controlled-clock-fake",
	command: ["controlled-clock-fake"],
	extensions: [".ts"],
	priority: 0,
};

class WiredTransport extends LspClientTransport {
	constructor(timeouts: LspClientTimeoutOptions, connection: JsonRpcConnection) {
		super("/tmp", fakeServer, timeouts);
		this.connection = connection;
	}

	request<T>(method: string, params: unknown, options: { timeoutMs?: number }): Promise<T> {
		return this.sendRequest<T>(method, params, options);
	}
}

function encodeMessage(message: Record<string, unknown>): string {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function makeWiredTransport(clock: ControlledClock): { transport: WiredTransport; serverToClient: PassThrough } {
	const serverToClient = new PassThrough();
	const clientToServer = new PassThrough();
	const connection = new JsonRpcConnection(serverToClient, clientToServer);
	connection.listen();
	return { transport: new WiredTransport({ timerProvider: clock }, connection), serverToClient };
}

describe("LspClientTransport request timeout via TimerProvider", () => {
	it("#given a request the server never answers #when the injected clock passes the timeout #then the request rejects with LspRequestTimeoutError", async () => {
		const clock = new ControlledClock();
		const { transport } = makeWiredTransport(clock);

		const pending = transport.request("textDocument/diagnostic", { textDocument: { uri: "file:///a.ts" } }, {
			timeoutMs: 50,
		});
		await clock.waitForTimer(50);
		expect(clock.scheduledDelays.at(-1)).toBe(50);
		clock.advanceBy(50);

		await expect(pending).rejects.toBeInstanceOf(LspRequestTimeoutError);
	});

	it("#given a request answered before the deadline #when the injected clock later passes the timeout #then the settled result stands", async () => {
		const clock = new ControlledClock();
		const { transport, serverToClient } = makeWiredTransport(clock);

		const pending = transport.request<{ items: unknown[] }>(
			"textDocument/diagnostic",
			{ textDocument: { uri: "file:///a.ts" } },
			{ timeoutMs: 50 },
		);
		await clock.waitForTimer(50);
		serverToClient.write(encodeMessage({ jsonrpc: "2.0", id: 1, result: { items: [] } }));

		await expect(pending).resolves.toEqual({ items: [] });
		clock.advanceBy(50);
	});
});
