import { describe, expect, it } from "vitest";
import { once } from "node:events";
import { acquiringEngineChildFactory, engineChildFactory } from "../src/service/child";
import { DesktopService } from "../src/service/service";
import { RpcClient } from "../src/service/rpc-client";
import { legacySelf, legacyUnresolved, refusalChild, refusalRecord } from "../../senpi-desktop-engine/test/refusal-child";
import { fakeEngineFactory, rejectionOf } from "./harness";

describe("actual child launch refusal", () => {
	it("joins stderr fragments ordered by an explicit pipe acknowledgement", async () => {
		const child = refusalChild({ split: true });
		let chunks = 0;
		child.stderr.on("data", () => { chunks += 1; });
		child.stderr.once("data", () => child.stdin.write("\n"));
		const service = new DesktopService({ createChild: () => child });
		expect(await rejectionOf(service.open({}))).toMatchObject({ code: "launch-context-unavailable" });
		expect(chunks).toBe(2);
		await service.close();
	}, 10_000);
	for (const reason of ["self-responsible", "unresolved"]) {
		it(`keeps ${reason} through initial activation and stderr tail eviction`, async () => {
			// Given: the bounded record precedes more than one diagnostic tail.
			const child = refusalChild({ stderr: refusalRecord(reason) + "x".repeat(8192) });
			const service = new DesktopService({ createChild: () => child });
			// When: the actual child refuses before hello.
			const error = await rejectionOf(service.open({}));
			// Then: no session exists and no automatic launch follows.
			expect(error).toMatchObject({ code: "launch-context-unavailable", reason });
			await service.close();
		}, 10_000);
	}

	it("keeps refusal through the acquiring factory", async () => {
		let starts = 0;
		const factory = acquiringEngineChildFactory({
			version: "0.0.0",
			host: "darwin-arm64",
			acquire: async () => ({ path: "/fixture/engine" }),
			spawnEngine: () => { starts += 1; return refusalChild(); },
		});
		const service = new DesktopService({ createChild: factory });
		expect(await rejectionOf(service.open({}))).toMatchObject({ code: "launch-context-unavailable" });
		expect(starts).toBe(1);
		await service.close();
	}, 10_000);

	it.skipIf(process.platform === "win32")("keeps refusal through an explicit executable path", async () => {
		// The executable fixture implements the same --stdio spawn contract.
		const path = new URL("./fixtures/refusing-engine", import.meta.url).pathname;
		const service = new DesktopService({ createChild: engineChildFactory(path) });
		expect(await rejectionOf(service.open({}))).toMatchObject({ code: "launch-context-unavailable" });
		await service.close();
	}, 10_000);

	it("reports a lazy restart refusal without replaying the action and permits a later explicit retry", async () => {
		const live = fakeEngineFactory();
		let starts = 0;
		const service = new DesktopService({
			createChild: () => ++starts === 2 ? refusalChild() : live.spawn(),
		});
		await service.open({});
		const first = live.children[0];
		if (first === undefined) throw new Error("missing fixture child");
		const closed = once(first, "close");
		first.kill();
		await closed;
		expect(await rejectionOf(service.call("click", {}))).toMatchObject({ code: "launch-context-unavailable" });
		expect(starts).toBe(2);
		expect(live.requests.filter((request) => request.method === "click")).toHaveLength(0);
		await service.capabilities();
		expect(starts).toBe(3);
		await service.close();
	}, 10_000);

	it("lets the drained refusal win over an earlier stdin EPIPE", async () => {
		const child = refusalChild();
		const rpc = new RpcClient(child, { onNotification: () => undefined, onExit: () => undefined });
		const result = rejectionOf(rpc.request("engine.hello", {}));
		child.stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
		expect(await result).toMatchObject({ code: "launch-context-unavailable", reason: "self-responsible" });
		await rpc.exited;
	}, 10_000);

	for (const [label, stderr, reason] of [
		["self", legacySelf, "self-responsible"],
		["unresolved", legacyUnresolved, "unresolved"],
	]) {
		it(`recognizes only the anchored older ${label} diagnostic`, async () => {
			const service = new DesktopService({ createChild: () => refusalChild({ stderr }) });
			expect(await rejectionOf(service.open({}))).toMatchObject({ code: "launch-context-unavailable", reason });
			await service.close();
		}, 10_000);
	}
});
