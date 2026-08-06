import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { JsonRpcConnection } from "../src/lsp/json-rpc-connection.js";

function encodeMessage(message: Record<string, unknown>): string {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function readOneMessage(stream: PassThrough): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		stream.once("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			const bodyStart = text.indexOf("\r\n\r\n") + 4;
			resolve(JSON.parse(text.slice(bodyStart)) as Record<string, unknown>);
		});
	});
}

describe("JsonRpcConnection", () => {
	it("#given a framed response #when sending request #then resolves the matching result", async () => {
		// given
		const serverOutput = new PassThrough();
		const serverInput = new PassThrough();
		const connection = new JsonRpcConnection(serverOutput, serverInput);
		connection.listen();
		const requestMessage = readOneMessage(serverInput);

		// when
		const resultPromise = connection.sendRequest<{ capabilities: Record<string, unknown> }>("initialize", {
			rootUri: "file:///tmp/project",
		});
		const request = await requestMessage;
		serverOutput.write(encodeMessage({ jsonrpc: "2.0", id: request["id"], result: { capabilities: {} } }));

		// then
		await expect(resultPromise).resolves.toEqual({ capabilities: {} });
		connection.dispose();
	});

	it("#given a server request #when handler returns #then writes a json-rpc response", async () => {
		// given
		const serverOutput = new PassThrough();
		const serverInput = new PassThrough();
		const connection = new JsonRpcConnection(serverOutput, serverInput);
		connection.onRequest("workspace/configuration", () => [{ validate: { enable: true } }]);
		connection.listen();

		// when
		const responseMessage = readOneMessage(serverInput);
		serverOutput.write(
			encodeMessage({
				jsonrpc: "2.0",
				id: 7,
				method: "workspace/configuration",
				params: { items: [{ section: "json" }] },
			}),
		);

		// then
		await expect(responseMessage).resolves.toMatchObject({
			jsonrpc: "2.0",
			id: 7,
			result: [{ validate: { enable: true } }],
		});
		connection.dispose();
	});
});
