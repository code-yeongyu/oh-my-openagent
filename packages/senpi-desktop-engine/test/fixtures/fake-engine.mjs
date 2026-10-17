#!/usr/bin/env node
// A script engine speaking just enough of the NDJSON protocol for the handshake.
// FAKE_ENGINE_MODE: "hello" (default) | "notify-first" | "error-reply" | "exit-before-reply"
// FAKE_ENGINE_ABI / FAKE_ENGINE_PROTOCOL override the advertised contract.
import { createInterface } from "node:readline";

const mode = process.env.FAKE_ENGINE_MODE ?? "hello";
const abi = process.env.FAKE_ENGINE_ABI ?? "senpi-desktop/1";
const protocolVersion = process.env.FAKE_ENGINE_PROTOCOL ?? "1";

if (!process.argv.includes("--stdio")) {
	process.stderr.write("fake-engine: expected --stdio\n");
	process.exit(2);
}
if (mode === "exit-before-reply") {
	process.stderr.write("fake-engine: refusing to start\n");
	process.exit(3);
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

createInterface({ input: process.stdin })
	.on("line", (line) => {
		const request = JSON.parse(line);
		if (request.method !== "engine.hello") return;
		if (mode === "notify-first") {
			send({ method: "engine.log", params: { level: "info", message: "starting" } });
		}
		if (mode === "error-reply") {
			send({ id: request.id, error: { code: -32603, message: "boom" } });
			return;
		}
		send({ id: request.id, result: { protocolVersion, engineVersion: "0.0.0-fake", buildSha: "fake", abi } });
	})
	.on("close", () => process.exit(0));
