import { DesktopEngineAbiMismatchError } from "@oh-my-opencode/senpi-desktop-engine";
import type { AuditEvent, StopPathStatus } from "@oh-my-opencode/senpi-desktop-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopEngineRpcError, DesktopServiceError } from "../src/service/rpc-client";
import { DesktopService } from "../src/service/service";
import {
	CLOSE_TIMEOUT_MS,
	GRACE_MS,
	HEARTBEAT_MS,
	HOLD_RELEASE_GRACE_MS,
	RESTART_MESSAGE,
	START_TIMEOUT_MS,
} from "../src/service/timeouts";
import { exitOf, fakeEngineFactory, rejectionOf, type SpawnLog } from "./harness";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };
// Only the service's own timers are faked; child-process stream I/O keeps running on the real loop.
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
	toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
};

const services: DesktopService[] = [];

function serviceOver(log: SpawnLog): DesktopService {
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	return service;
}

function payload(result: unknown): { readonly method?: unknown; readonly pid?: unknown } {
	return typeof result === "object" && result !== null ? result : {};
}

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(services.splice(0).map((service) => service.close()));
});

describe("DesktopService", HANG_GUARD, () => {
	it("opens and reads capabilities from an older engine without cursorOverlay", async () => {
		// Given: the real wire fixture advertises the pre-cursor capability shape.
		const log = fakeEngineFactory({ FAKE_ENGINE_CURSOR_OMITTED: "1" });
		const service = serviceOver(log);

		// When: both session.open and the capabilities RPC cross the host parser.
		const opened = await service.open({});
		const current = await service.capabilities();

		// Then: the older engine remains usable and does not advertise overlay support.
		expect(opened.cursorOverlay).toBe(false);
		expect(current.cursorOverlay).toBe(false);
		expect(current.backend).toBe("fake");
	});

	it("opens with engine.hello then session.open and resumes with the token the service kept", async () => {
		// Given
		const log = fakeEngineFactory();
		const service = serviceOver(log);

		// When
		const capabilities = await service.open({});
		await service.stop();
		const resumed = await service.resume();

		// Then
		expect(capabilities.backend).toBe("fake");
		expect(log.requests.slice(0, 2).map((request) => request.method)).toEqual(["engine.hello", "session.open"]);
		expect(resumed.suspended).toBe(false);
	});

	it("rejects with a start timeout and kills the child once when the engine never answers engine.hello", async () => {
		// Given
		vi.useFakeTimers(TIMERS);
		const log = fakeEngineFactory({ FAKE_ENGINE_MODE: "silent" });
		const service = serviceOver(log);
		const opening = rejectionOf(service.open({}));
		await log.nthRequest("engine.hello", 1);

		// When
		await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
		const error = await opening;

		// Then
		expect(error).toBeInstanceOf(DesktopServiceError);
		expect(error).toHaveProperty("message", "Timed out starting desktop engine");
		expect(log.kills()).toBe(1);
	});

	it("refuses an engine with another ABI and kills it", async () => {
		// Given
		const log = fakeEngineFactory({ FAKE_ENGINE_ABI: "senpi-desktop/0" });
		const service = serviceOver(log);

		// When
		const error = await rejectionOf(service.open({}));

		// Then
		expect(error).toBeInstanceOf(DesktopEngineAbiMismatchError);
		expect(log.kills()).toBe(1);
		expect(log.requests.map((request) => request.method)).not.toContain("session.open");
	});

	it("routes out-of-order replies to the request ids that asked for them", async () => {
		// Given
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const settled: string[] = [];

		// When
		const held = service
			.call("windows", { fake: "hold" })
			.then((result) => settled.push(`held:${payload(result).method}`));
		await log.nthRequest("windows", 1);
		const release = service
			.call("displays", { fake: "release" })
			.then((result) => settled.push(`release:${payload(result).method}`));
		await Promise.all([held, release]);

		// Then
		expect(settled).toEqual(["release:displays", "held:held"]);
	});

	it("sends $/cancel for an aborted call and keeps the engine that honored it", async () => {
		// Given
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const abort = new AbortController();
		const pending = rejectionOf(service.call("capture", { fake: "cancellable" }, { signal: abort.signal }));
		const sent = await log.nthRequest("capture", 1);

		// When
		abort.abort();
		const error = await pending;

		// Then
		const cancel = await log.nthRequest("$/cancel", 1);
		expect(cancel.params).toEqual({ id: sent.id });
		expect(error).toBeInstanceOf(DesktopServiceError);
		expect(error).toHaveProperty("code", "Cancelled");
		expect(error).toHaveProperty("engineRestarted", false);
		expect(payload(await service.call("displays", {})).pid).toBe(log.children[0]?.pid);
		expect(log.kills()).toBe(0);
	});

	it("kills an engine that ignores $/cancel after the grace period and respawns it with the session replayed", async () => {
		// Given
		vi.useFakeTimers(TIMERS);
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({ display: "all" });
		await service.ensureStopPath("ctrl+alt+shift+escape");
		const hung = rejectionOf(service.call("typeText", { fake: "hang" }, { timeoutMs: 100 }));
		await log.nthRequest("typeText", 1);
		await vi.advanceTimersByTimeAsync(100);
		await log.nthRequest("$/cancel", 1);

		// When
		await vi.advanceTimersByTimeAsync(GRACE_MS);
		const error = await hung;
		await exitOf(log.children[0]);
		const next = await service.call("displays", {});

		// Then
		expect(error).toHaveProperty("code", "Timeout");
		expect(error).toHaveProperty("engineRestarted", true);
		expect(error).toHaveProperty("message", `typeText timed out after 100 ms; ${RESTART_MESSAGE}`);
		expect(log.kills()).toBe(1);
		expect(payload(next).pid).toBe(log.children[1]?.pid);
		const replayed = log.requests.filter((request) => request.child === 1).map((request) => request.method);
		expect(replayed.slice(0, 3)).toEqual(["engine.hello", "session.open", "stopPath.start"]);
		expect((await log.nthRequest("session.open", 2)).params).toEqual({ display: "all", showCursor: true });
	});

	it("gives a cancelled hold the longer release grace before killing the engine", async () => {
		// Given
		vi.useFakeTimers(TIMERS);
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const hung = rejectionOf(service.call("holdKeys", { keys: ["shift"], duration: 1, fake: "hang" }, { timeoutMs: 100 }));
		await log.nthRequest("holdKeys", 1);
		await vi.advanceTimersByTimeAsync(100);
		await log.nthRequest("$/cancel", 1);

		// When the ordinary grace has passed, the engine may still be releasing the held input
		await vi.advanceTimersByTimeAsync(GRACE_MS);
		const killedDuringRelease = log.kills();
		await vi.advanceTimersByTimeAsync(HOLD_RELEASE_GRACE_MS - GRACE_MS);
		await hung;

		// Then
		expect(killedDuringRelease).toBe(0);
		expect(log.kills()).toBe(1);
	});

	it("closes quietly right after a grace kill, before the killed child has exited", async () => {
		// Given
		vi.useFakeTimers(TIMERS);
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const hung = rejectionOf(service.call("typeText", { fake: "hang" }, { timeoutMs: 100 }));
		await log.nthRequest("typeText", 1);
		await vi.advanceTimersByTimeAsync(100 + GRACE_MS);
		await hung;

		// When
		const closing = service.close();

		// Then
		await expect(closing).resolves.toBeUndefined();
		await exitOf(log.children[0]);
		expect(log.requests.map((request) => request.method)).not.toContain("session.close");
	});

	it("heartbeats every HEARTBEAT_MS while the session is open and stops on close", async () => {
		// Given
		vi.useFakeTimers(TIMERS);
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});

		// When
		await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
		await log.nthRequest("stopPath.heartbeat", 3);
		await service.close();
		await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);

		// Then
		expect(log.requests.filter((request) => request.method === "stopPath.heartbeat")).toHaveLength(3);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cancels an in-flight hold before sending session.close", async () => {
		// Given a call that only answers cancellation.
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const pending = rejectionOf(service.call("holdKeys", { fake: "cancellable" }));
		const sent = await log.nthRequest("holdKeys", 1);
		// When the service closes.
		await service.close();
		// Then cancellation precedes close on the same stream.
		expect(await pending).toHaveProperty("code", "Cancelled");
		const cancel = log.requests.findIndex((request) => request.method === "$/cancel");
		const close = log.requests.findIndex((request) => request.method === "session.close");
		expect(cancel).toBeGreaterThanOrEqual(0);
		expect(close).toBeGreaterThan(cancel);
		expect(log.requests[cancel]?.params).toEqual({ id: sent.id });
	});

	it("surfaces a cancelled hold's input release failure instead of a plain Timeout", async () => {
		// Given a hold whose cancel reply carries the engine's merged release failure
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const pending = rejectionOf(
			service.call("holdKeys", { keys: ["shift"], duration: 1, fake: "release-fails" }, { timeoutMs: 50 }),
		);
		await log.nthRequest("holdKeys", 1);

		// When the timeout cancels it
		const error = await pending;

		// Then the caller sees the engine's release failure, not the service's own Timeout
		expect(error).toBeInstanceOf(DesktopEngineRpcError);
		expect(String((error as Error).message)).toContain("input release also failed");
		expect(log.kills()).toBe(0);
	});

	it("leaves a pipelined non-hold request running when the service closes", async () => {
		// Given a held non-hold request and an in-flight hold
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const grant = service.call("displays", { fake: "hold" });
		const hold = rejectionOf(service.call("holdKeys", { fake: "cancellable" }));
		await log.nthRequest("holdKeys", 1);
		const grantId = (await log.nthRequest("displays", 1)).id;

		// When the service closes
		const closing = service.close();
		await hold;

		// Then only the hold is cancelled
		const cancelled = log.requests.filter((request) => request.method === "$/cancel").map((request) => request.params);
		expect(cancelled).not.toContainEqual({ id: grantId });
		expect(cancelled).toHaveLength(1);
		void grant.catch(() => undefined);
		await closing;
	});

	it("gives close at least the engine's hold release window before killing the child", () => {
		// The engine waits up to 2 s for a cancelled hold's release; close must not kill it sooner.
		expect(CLOSE_TIMEOUT_MS).toBeGreaterThanOrEqual(HOLD_RELEASE_GRACE_MS);
	});

	it("fans audit and stopPath.changed notifications out to every current listener", async () => {
		// Given
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const first: AuditEvent[] = [];
		const second: AuditEvent[] = [];
		const removed: AuditEvent[] = [];
		const stopPaths: StopPathStatus[] = [];
		service.onAudit((event) => first.push(event));
		service.onAudit((event) => second.push(event));
		service.onAudit((event) => removed.push(event))();
		service.onStopPathChange((status) => stopPaths.push(status));

		// When
		await service.call("click", { fake: "notify" });

		// Then
		expect(first).toEqual([{ action: "click", target: "screen", delivery: "background", durationMs: 3 }]);
		expect(second).toEqual(first);
		expect(removed).toEqual([]);
		expect(stopPaths.map((status) => status.stopPath)).toEqual(["global"]);
	});

	it("rejects every pending call with Closed when the engine exits", async () => {
		// Given
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});
		const held = rejectionOf(service.call("windows", { fake: "hold" }));
		await log.nthRequest("windows", 1);

		// When
		const exiting = rejectionOf(service.call("displays", { fake: "exit" }));

		// Then
		for (const error of await Promise.all([held, exiting])) {
			expect(error).toBeInstanceOf(DesktopServiceError);
			expect(error).toHaveProperty("code", "Closed");
			expect(error).toHaveProperty("message", expect.stringContaining("code 7"));
		}
		await expect(service.close()).resolves.toBeUndefined();
	});

	it("arms the stop path once per chord and only reads the status on a repeat", async () => {
		// Given
		const log = fakeEngineFactory();
		const service = serviceOver(log);
		await service.open({});

		// When
		await service.ensureStopPath("ctrl+alt+shift+escape");
		await service.ensureStopPath("ctrl+alt+shift+escape");

		// Then
		const stopPathMethods = log.requests
			.map((request) => request.method)
			.filter((method) => method.startsWith("stopPath.s"));
		expect(stopPathMethods).toEqual(["stopPath.start", "stopPath.status"]);
	});
});
