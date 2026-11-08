import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locateDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine";
import { describe, expect, it } from "vitest";
import { DesktopEngineRpcError, RpcClient } from "../src/service/rpc-client";
import { rejectionOf } from "./harness";

const scenario = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../crates/senpi-desktop-backend-fake/fixtures/two-displays-one-window.json",
);

/** Over the engine's 1 MiB request line cap (connection.rs MAX_REQUEST_BYTES). */
const OVER_CAP = 2 * 1024 * 1024;

const hooks = { onNotification: () => undefined, onExit: () => undefined };

describe("an oversized request", { timeout: 30_000 }, () => {
	it("is refused request_too_large under its own id by the real engine, which stays usable", async () => {
		// Given
		const location = locateDesktopEngine();
		if (location.path === null) {
			expect(location.diagnostic.code).toBe("native-unavailable");
			return;
		}
		const child = spawn(location.path, ["--stdio"], {
			stdio: "pipe",
			env: { ...process.env, SENPI_DESKTOP_BACKEND: `fake:${scenario}` },
		});
		const rpc = new RpcClient(child, hooks);

		// When
		const refused = await rejectionOf(rpc.request("clipboard.write", { text: "x".repeat(OVER_CAP) }));

		// Then
		expect(refused).toBeInstanceOf(DesktopEngineRpcError);
		expect(refused).toMatchObject({ method: "clipboard.write", data: { code: "Internal", reason: "request_too_large" } });
		await expect(rpc.request("engine.hello", {})).resolves.toMatchObject({ protocolVersion: expect.any(String) });
		rpc.end();
		await rpc.exited;
	});

	it("whose id the engine cannot read rejects the pending call with the engine's refusal when it closes", async () => {
		// Given: an engine that refuses the first line with a null id, then exits as the real one closes
		const refusal = {
			jsonrpc: "2.0",
			id: null,
			error: { code: -32603, message: "too large, closing", data: { code: "Internal", reason: "request_too_large" } },
		};
		const script = `
			const lines = require("node:readline").createInterface({ input: process.stdin });
			lines.once("line", () => process.stdout.write(${JSON.stringify(`${JSON.stringify(refusal)}\n`)}, () => process.exit(0)));
		`;
		const rpc = new RpcClient(spawn(process.execPath, ["-e", script], { stdio: "pipe" }), hooks);

		// When
		const refused = await rejectionOf(rpc.request("clipboard.write", { text: "x" }));

		// Then: the reason, not a bare Closed
		expect(refused).toBeInstanceOf(DesktopEngineRpcError);
		expect(refused).toMatchObject({
			method: "clipboard.write",
			message: "too large, closing",
			data: { code: "Internal", reason: "request_too_large" },
			cause: { code: "Closed" },
		});
	});
});
