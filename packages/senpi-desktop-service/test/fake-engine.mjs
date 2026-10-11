#!/usr/bin/env node
// A script engine speaking the NDJSON JSON-RPC protocol for DesktopService tests.
// FAKE_ENGINE_MODE: "normal" (default) | "silent" (never answers anything, including engine.hello).
// FAKE_ENGINE_ABI overrides the advertised ABI.
// FAKE_ENGINE_DESKTOP=1 answers desktop methods without `params.fake` from test/fake-desktop.mjs;
// FAKE_ENGINE_STALL=<method> then treats that method as "cancellable".
// Every received line is echoed first as an `engine.log` notification ("recv <line>") so tests observe the wire.
// Any other method is steered by `params.fake`:
//   "hold"        - reply only after a "release" request arrives (after the release reply)
//   "release"     - reply, then flush every held reply
//   "hang"        - never reply, ignore $/cancel
//   "cancellable" - never reply until $/cancel names this id, then reply Cancelled
//   "notify"      - emit one audit and one stopPath.changed notification, then reply
//   "exit"        - exit with code 7 without replying
//   otherwise     - reply { method, params, pid }
import { createInterface } from "node:readline";
import { createDesktop } from "./fake-desktop.mjs";

const mode = process.env.FAKE_ENGINE_MODE ?? "normal";
const abi = process.env.FAKE_ENGINE_ABI ?? "senpi-desktop/1";
const resumeToken = `token-${process.pid}`;
const desktop = process.env.FAKE_ENGINE_DESKTOP === "1" ? createDesktop() : undefined;
const stalled = process.env.FAKE_ENGINE_STALL;

if (!process.argv.includes("--stdio")) {
	process.stderr.write("fake-engine: expected --stdio\n");
	process.exit(2);
}

const capabilities = {
	backend: "fake",
	displayServer: null,
	capture: true,
	input: true,
	ax: true,
	backgroundWindowInput: true,
	deliveryModes: ["background", "foreground"],
	capturePermission: "granted",
	inputPermission: "granted",
	axPermission: "granted",
	displayCount: 1,
	focusGuard: true,
	stopPath: "global",
	stopReason: null,
	integrityLevel: null,
	screenLocked: false,
};
let suspended = false;
const status = () => ({
	suspended,
	globalLive: true,
	hostRelayLive: true,
	heartbeatFresh: true,
	stopPath: "global",
	reason: null,
});

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const reply = (id, result) => send({ id, result });
const fail = (id, code, message) => send({ id, error: { code: -32000, message, data: { code, hint: null } } });
const held = [];
const cancellable = new Set();

function handle(request) {
	const { id, method, params } = request;
	switch (method) {
		case "engine.hello":
			return reply(id, { protocolVersion: "1", engineVersion: "0.0.0-fake", buildSha: "fake", abi });
		case "session.open":
			return reply(id, { capabilities, resumeToken });
		case "session.close":
		case "stopPath.heartbeat":
			return reply(id, null);
		case "capabilities":
			return reply(id, capabilities);
		case "stopPath.start":
		case "stopPath.status":
			return reply(id, status());
		case "stopPath.stop":
			suspended = true;
			send({ method: "stopPath.changed", params: status() });
			return reply(id, status());
		case "stopPath.resume":
			if (params?.token !== resumeToken) return fail(id, "InvalidTarget", "wrong resume token");
			suspended = false;
			send({ method: "stopPath.changed", params: status() });
			return reply(id, status());
		case "$/cancel":
			if (cancellable.delete(params.id)) fail(params.id, "Cancelled", "request was cancelled by $/cancel");
			return;
	}
	if (desktop !== undefined && params?.fake === undefined) {
		if (method === stalled) return cancellable.add(id);
		const outcome = desktop(method, params);
		if (outcome !== undefined) {
			const { notifications = [], ...reply } = outcome;
			for (const notification of notifications) send(notification);
			return send({ id, ...reply });
		}
	}
	switch (params?.fake) {
		case "hold":
			return held.push(id);
		case "release":
			reply(id, { method, params, pid: process.pid });
			for (const heldId of held.splice(0)) reply(heldId, { method: "held", pid: process.pid });
			return;
		case "hang":
			return;
		case "cancellable":
			return cancellable.add(id);
		case "notify":
			send({ method: "audit", params: { action: method, target: "screen", delivery: "background", durationMs: 3 } });
			send({ method: "stopPath.changed", params: status() });
			return reply(id, { method, params, pid: process.pid });
		case "exit":
			return process.exit(7);
		default:
			return reply(id, { method, params, pid: process.pid });
	}
}

createInterface({ input: process.stdin })
	.on("line", (line) => {
		send({ method: "engine.log", params: { level: "debug", message: `recv ${line}` } });
		if (mode !== "silent") handle(JSON.parse(line));
	})
	.on("close", () => process.exit(0));
