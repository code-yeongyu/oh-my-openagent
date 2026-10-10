import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { at, EngineProcess, type Message, TEST_TIMEOUT_MS, TWO_DISPLAYS } from "./support/engine";

const open: Array<{ readonly client: EngineProcess; readonly dir: string }> = [];

function endpoint(dir: string): string {
	return process.platform === "win32"
		? `\\\\.\\pipe\\senpi-mcp-test-${process.pid}-${path.basename(dir)}`
		: path.join(dir, "engine.sock");
}

async function mcpClient(liveStopPath: boolean): Promise<EngineProcess> {
	const dir = mkdtempSync(path.join(tmpdir(), "senpi-mcp-"));
	const env: Record<string, string> = { SENPI_DESKTOP_BACKEND: `fake:${TWO_DISPLAYS}` };
	if (liveStopPath) env.SENPI_DESKTOP_FAKE_STOP_PATH = "live";
	const client = new EngineProcess(env, [
		"--mcp",
		"--endpoint",
		endpoint(dir),
		"--idle-ms",
		"2000",
		"--audit-path",
		path.join(dir, "audit.jsonl"),
	]);
	open.push({ client, dir });
	const initialized = await client.call("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
	expect(at(initialized, "result", "serverInfo", "name")).toBe("senpi-desktop-engine");
	client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
	return client;
}

function toolCall(client: EngineProcess, name: string, args: Readonly<Record<string, unknown>> = {}): Promise<Message> {
	return client.call("tools/call", { name, arguments: args });
}

afterEach(async () => {
	for (const { client, dir } of open.splice(0)) {
		await client.finish();
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("senpi-desktop-engine --mcp", () => {
	it(
		"lists exactly the bridge's tools: public methods and stop, never resume or host controls",
		async () => {
			// Given
			const client = await mcpClient(true);

			// When
			const listed = await client.call("tools/list");

			// Then
			const tools = at(listed, "result", "tools");
			const names = Array.isArray(tools) ? tools.map((tool) => at(tool, "name")) : [];
			expect(names).toEqual(expect.arrayContaining(["desktop_capture", "desktop_click", "desktop_stop"]));
			expect(names.filter((name) => /resume|session_open|stopPath_start|heartbeat/.test(String(name)))).toEqual([]);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"returns a desktop capture as an MCP image block with its frame metadata",
		async () => {
			// Given
			const client = await mcpClient(true);

			// When
			const captured = await toolCall(client, "desktop_capture", { target: "desktop", caps: { maxWidth: 320 } });

			// Then
			const content = at(captured, "result", "content");
			const image = Array.isArray(content) ? content[0] : undefined;
			expect(at(image, "type"), JSON.stringify(captured).slice(0, 600)).toBe("image");
			expect(at(image, "mimeType")).toMatch(/^image\//);
			expect(typeof at(captured, "result", "structuredContent", "frameId")).toBe("string");
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"refuses input with the engine's StopPathUnavailable when no stop path is live, as over JSON-RPC",
		async () => {
			// Given
			const client = await mcpClient(false);

			// When
			const clicked = await toolCall(client, "desktop_click", { target: "desktop", x: 10, y: 10 });

			// Then
			expect(at(clicked, "result", "isError"), JSON.stringify(clicked).slice(0, 600)).toBe(true);
			const content = at(clicked, "result", "content");
			const text = Array.isArray(content) ? at(content[0], "text") : undefined;
			expect(at(JSON.parse(String(text)), "data", "code")).toBe("StopPathUnavailable");
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"answers an unknown or unlisted tool with a JSON-RPC error",
		async () => {
			// Given
			const client = await mcpClient(true);

			// When
			const replies = await Promise.all(
				["desktop_nope", "desktop_stopPath_resume"].map((name) => toolCall(client, name)),
			);

			// Then
			expect(replies.map((reply) => at(reply, "error", "code"))).toEqual([-32602, -32602]);
		},
		TEST_TIMEOUT_MS,
	);
});
