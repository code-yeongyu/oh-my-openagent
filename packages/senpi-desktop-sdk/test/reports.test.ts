import { afterEach, describe, expect, it } from "vitest";
import { ComputerError, connect } from "../src/index";
import { type FakePort, fakeEnginePort, interceptPort, PortFailure } from "./fake-port";

const ports: FakePort[] = [];

function port(env: Readonly<Record<string, string>> = {}): FakePort {
	const created = fakeEnginePort(env);
	ports.push(created);
	return created;
}

afterEach(async () => {
	await Promise.all(ports.splice(0).map((open) => open.close()));
});

async function codeWindow(fake: FakePort) {
	const computer = await connect({ kind: "inProcess", port: fake });
	const code = await computer.window({ app: "Code" });
	return { computer, code, frame: await code.screenshot() };
}

describe("action reports", () => {
	it("#given an engine without action-report #when an exec replies null #then the legacy report says delivered_unverified, unverifiable, legacy", async () => {
		const { code, frame } = await codeWindow(port());

		expect(await code.pointer.click({ frame, x: 1, y: 1 })).toEqual({
			disposition: { delivery: "delivered_unverified", retry: "unsafe" },
			delivered: null,
			effect: "unverifiable",
			route: null,
			hit: null,
			focusRestoration: "not_confirmed",
			openedSurfaces: [],
			nextCall: null,
			note: null,
			warning: null,
			auditIds: [],
			timings: null,
			legacy: true,
		});
	});

	it("#given an action-report engine in an object-mode session #when an exec replies a report #then it is returned with legacy false", async () => {
		const fake = port({ FAKE_ENGINE_FEATURES: '["action-report"]' });
		await fake.call("session.open", { reportMode: "object" });
		const { code, frame } = await codeWindow(fake);

		expect(await code.pointer.click({ frame, x: 1, y: 1 })).toMatchObject({
			disposition: { delivery: "delivered_unverified", retry: "unsafe" },
			auditIds: ["audit-click"],
			legacy: false,
		});
	});

	it("#given a fake port returning a malformed ActionReport #when an exec runs #then ComputerError Internal with nothingSent false", async () => {
		const malformed = JSON.stringify({ disposition: { delivery: "not_delivered", retry: "unsafe" }, effect: "confirmed" });
		const { code, frame } = await codeWindow(port({ FAKE_ENGINE_EXEC_REPLY: malformed }));
		const failure = await code.pointer.click({ frame, x: 1, y: 1 }).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(ComputerError);
		expect(failure).toMatchObject({
			code: "Internal",
			nothingSent: false,
			disposition: { delivery: "unknown", retry: "unknown" },
			data: { reason: "malformed_result" },
		});
	});

	it("#given a report claiming the SDK-only effect refused #when an engine sends it #then it is malformed, not trusted", async () => {
		const refused = JSON.stringify({
			disposition: { delivery: "not_delivered", retry: "safe" },
			effect: "refused",
			focusRestoration: "not_needed",
			auditIds: [],
		});
		const { code } = await codeWindow(port({ FAKE_ENGINE_EXEC_REPLY: refused }));

		await expect(code.raise()).rejects.toMatchObject({ code: "Internal", data: { reason: "malformed_result" } });
	});
});

describe("errors", () => {
	it("#given an engine error without disposition #when an exec fails #then the code and data are kept and the outcome is unknown", async () => {
		const { code, frame } = await codeWindow(port({ FAKE_ENGINE_INPUT_ERROR: "PermissionDenied" }));
		const failure = await code.pointer.click({ frame, x: 1, y: 1 }).catch((error: unknown) => error);

		expect(failure).toMatchObject({ code: "PermissionDenied", nothingSent: false, disposition: { delivery: "unknown" } });
		expect((failure as ComputerError).data.engine).toMatchObject({ permission: { permission: "accessibility" } });
	});

	it("#given an engine error carrying not_delivered/after_user #when an exec fails #then nothingSent is true", async () => {
		const refusing = interceptPort(port(), async (method, _params, forward) => {
			if (method !== "typeText") return forward();
			throw new PortFailure({
				code: -32015,
				message: "input is suspended",
				data: { code: "Suspended", disposition: { delivery: "not_delivered", retry: "after_user" } },
			});
		});
		const { code } = await codeWindow(refusing);

		await expect(code.keyboard.type("x")).rejects.toMatchObject({
			code: "Suspended",
			nothingSent: true,
			disposition: { delivery: "not_delivered", retry: "after_user" },
		});
	});

	it("#given a frame of another target or a zoom #when aiming input with it #then InvalidCoordinateFrame refuses before sending", async () => {
		const fake = port();
		const { computer, code, frame } = await codeWindow(fake);
		const desktopFrame = await computer.desktop.screenshot();
		const zoom = await frame.zoom({ x: 0, y: 0, width: 4, height: 4 });
		const sent = fake.requests.length;

		await expect(code.pointer.click({ frame: desktopFrame, x: 1, y: 1 })).rejects.toMatchObject({
			code: "InvalidCoordinateFrame",
			nothingSent: true,
			data: { reason: "other_target" },
		});
		await expect(code.pointer.click({ frame: zoom, x: 1, y: 1 })).rejects.toMatchObject({
			data: { reason: "zoom_frame" },
		});
		await expect(code.pointer.hold({ frame, x: 1, y: 1 }, { durationSeconds: 101 })).rejects.toMatchObject({
			data: { reason: "invalid_duration" },
		});
		expect(fake.requests.length).toBe(sent);
	});

	it("#given a transport kind this SDK does not have #when connecting #then it refuses", async () => {
		const transport = { kind: "remote" } as unknown as Parameters<typeof connect>[0];

		await expect(connect(transport)).rejects.toMatchObject({
			code: "InvalidTarget",
			data: { reason: "unsupported_transport" },
		});
	});
});

describe("batch", () => {
	it("#given a failing middle step #when the batch runs #then it stops there, reports refused, and skips the rest", async () => {
		const fake = port();
		const { computer, code, frame } = await codeWindow(fake);
		const desktopFrame = await computer.desktop.screenshot();
		const report = await computer.batch([
			{ label: "click", run: () => code.pointer.click({ frame, x: 1, y: 1 }) },
			{ label: "bad aim", run: () => code.pointer.click({ frame: desktopFrame, x: 1, y: 1 }) },
			{ label: "type", run: () => code.keyboard.type("never") },
		]);

		expect(report).toMatchObject({ completed: 1, of: 3, stoppedAt: 1 });
		expect(report.steps.map((step) => step.status)).toEqual(["ok", "failed", "skipped"]);
		expect(report.steps[1]).toMatchObject({ report: { effect: "refused", disposition: { delivery: "not_delivered" } } });
		expect(fake.requests.map((request) => request.method)).not.toContain("typeText");
	});
});
