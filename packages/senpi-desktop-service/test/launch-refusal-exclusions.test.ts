import { describe, expect, it } from "vitest";
import { RpcClient } from "../src/service/rpc-client";
import { DesktopService } from "../src/service/service";
import { legacySelf, refusalChild, refusalRecord, type RefusalOptions } from "../../senpi-desktop-engine/test/refusal-child";
import { rejectionOf } from "./harness";

const invalid = [
	["invalid JSON", "SENPI_DESKTOP_LAUNCH_REFUSED {bad}\n"],
	["unknown version", 'SENPI_DESKTOP_LAUNCH_REFUSED {"version":2,"reason":"self-responsible"}\n'],
	["unknown reason", refusalRecord("other")],
	["extra field", 'SENPI_DESKTOP_LAUNCH_REFUSED {"version":1,"reason":"unresolved","extra":true}\n'],
	["duplicate field", 'SENPI_DESKTOP_LAUNCH_REFUSED {"version":2,"version":1,"reason":"unresolved"}\n'],
	["oversized record", `SENPI_DESKTOP_LAUNCH_REFUSED ${" ".repeat(512)}{"version":1,"reason":"unresolved"}\n`],
	["unterminated record", refusalRecord().trimEnd()],
	["embedded legacy text", `prefix ${legacySelf}`],
] as const;

describe("startup classification exclusions", () => {
	for (const [name, record] of invalid) {
		it(`does not rescue ${name} with a legacy diagnostic`, async () => {
			// Given: malformed structured output must not fall through to older output.
			const stderr = name === "unterminated record" || name === "embedded legacy text" ? record : record + legacySelf;
			const service = new DesktopService({ createChild: () => refusalChild({ stderr }) });
			const error = await rejectionOf(service.open({}));
			expect(error).not.toHaveProperty("code", "launch-context-unavailable");
			await service.close();
		}, 10_000);
	}
	for (const [name, options] of [
		["successful exit", { code: 0 }],
		["structured marker with a non-gate exit", { code: 3 }],
		["ordinary crash", { stderr: "crashed\n", code: 3 }],
		["post-hello marker", { hello: true }],
		["ABI mismatch", { hello: true, abi: "wrong" }],
	] satisfies readonly (readonly [string, RefusalOptions])[]) {
		it(`does not relabel ${name}`, async () => {
			const service = new DesktopService({ createChild: () => refusalChild(options) });
			const error = await rejectionOf(service.open({}));
			expect(error).not.toHaveProperty("code", "launch-context-unavailable");
			await service.close();
		}, 10_000);
	}
	it("preserves cancellation even when the child subsequently emits a refusal", async () => {
		const child = refusalChild({ waitForCancel: true });
		const rpc = new RpcClient(child, { onNotification: () => undefined, onExit: () => undefined });
		const controller = new AbortController();
		const result = rejectionOf(rpc.request("engine.hello", {}, { signal: controller.signal }));
		controller.abort();
		expect(await result).toHaveProperty("code", "Cancelled");
		await rpc.exited;
	}, 10_000);
	it("preserves timeout when the child writes a marker only after receiving cancel", async () => {
		// Time is the behavior under test. The child waits for $/cancel, not a sleep.
		const rpc = new RpcClient(refusalChild({ waitForCancel: true }), {
			onNotification: () => undefined, onExit: () => undefined,
		});
		expect(await rejectionOf(rpc.request("engine.hello", {}, { timeoutMs: 0 })))
			.toHaveProperty("code", "Timeout");
		await rpc.exited;
	}, 10_000);
});
