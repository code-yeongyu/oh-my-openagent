import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LspClientConnection } from "../src/lsp/connection.js";
import { LspRequestTimeoutError } from "../src/lsp/errors.js";
import type { ResolvedServer } from "../src/lsp/types.js";

const FAKE_LSP_SERVER_SCRIPT = `
let buffer = Buffer.alloc(0);
const initializeDelayMs = Number(process.env.FAKE_LSP_INITIALIZE_DELAY_MS ?? "0");
function send(message) {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
	process.stdout.write(body);
}
function onMessage(message) {
	if (message.method === "initialize") {
		setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } }), initializeDelayMs);
		return;
	}
	if (message.method === "shutdown") {
		send({ jsonrpc: "2.0", id: message.id, result: null });
		return;
	}
	if (message.method === "exit") {
		process.exit(0);
	}
}
process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	for (;;) {
		const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
		if (headerEnd === -1) return;
		const match = /Content-Length: (\\d+)/i.exec(buffer.slice(0, headerEnd).toString("utf8"));
		if (!match) {
			buffer = buffer.slice(headerEnd + 4);
			continue;
		}
		const length = Number(match[1]);
		if (buffer.length < headerEnd + 4 + length) return;
		const body = buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
		buffer = buffer.slice(headerEnd + 4 + length);
		onMessage(JSON.parse(body));
	}
});
`;

class TestConnection extends LspClientConnection {
	request<T>(method: string, params: unknown): Promise<T> {
		return this.sendRequest<T>(method, params);
	}
}

function fakeServer(initializeDelayMs: number): ResolvedServer {
	return {
		id: "fake-slow-init",
		command: [process.execPath, "-e", FAKE_LSP_SERVER_SCRIPT],
		extensions: [".fake"],
		priority: 0,
		env: { FAKE_LSP_INITIALIZE_DELAY_MS: String(initializeDelayMs) },
	};
}

describe("LspClientConnection timeouts", () => {
	let root = "";
	const connections: TestConnection[] = [];

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "lsp-initialize-timeout-"));
	});

	afterEach(async () => {
		for (const connection of connections.splice(0)) {
			await connection.stop();
		}
		rmSync(root, { recursive: true, force: true });
	});

	it("#given initialize response slower than the request timeout #when initialize runs #then it succeeds within the initialize timeout", {
		timeout: 10_000,
	}, async () => {
		// given
		const connection = new TestConnection(root, fakeServer(600), {
			requestTimeoutMs: 150,
			initializeTimeoutMs: 5_000,
		});
		connections.push(connection);
		await connection.start();

		// when / then
		await expect(connection.initialize()).resolves.toBeUndefined();
	});

	it("#given an unanswered request after initialize #when the request runs #then it times out at the injected request timeout", {
		timeout: 5_000,
	}, async () => {
		// given
		const connection = new TestConnection(root, fakeServer(0), {
			requestTimeoutMs: 150,
			initializeTimeoutMs: 5_000,
		});
		connections.push(connection);
		await connection.start();
		await connection.initialize();

		// when
		const startedAt = Date.now();
		const request = connection.request("textDocument/hover", {
			textDocument: { uri: "file:///unanswered.fake" },
			position: { line: 0, character: 0 },
		});

		// then
		await expect(request).rejects.toThrow(LspRequestTimeoutError);
		expect(Date.now() - startedAt).toBeLessThan(2_000);
	});
});
