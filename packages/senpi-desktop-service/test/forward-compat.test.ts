import type { AuditEvent } from "@oh-my-opencode/senpi-desktop-protocol";
import { describe, expect, it } from "vitest";
import { NotificationHub } from "../src/service/notifications";
import { isDesktopCapabilities, parseErrorData } from "../src/service/parse";

// A host and an engine from different releases still talk: codes, actions and capability fields one side does not
// know are tolerated, never fatal (ErrorCode amendment 1, #11461).

const click = { action: "click", target: "101", delivery: "background", durationMs: 3 } as const;

function dispatchAudit(params: unknown): { readonly events: AuditEvent[]; readonly errors: Error[] } {
	const hub = new NotificationHub();
	const events: AuditEvent[] = [];
	const errors: Error[] = [];
	hub.onAudit((event) => events.push(event));
	hub.onError((error) => errors.push(error));
	hub.dispatch("audit", params);
	return { events, errors };
}

describe("audit notifications from a newer engine", () => {
	it("keeps an event whose code this host does not know, as unknown", () => {
		const { events, errors } = dispatchAudit({ ...click, code: "SomeFutureCode" });
		expect({ events, errors }).toEqual({ events: [{ ...click, code: "unknown" }], errors: [] });
	});

	it("keeps an event whose action this host does not know, as unknown", () => {
		const { events, errors } = dispatchAudit({ ...click, action: "window.someFutureMethod", code: null });
		expect({ events, errors }).toEqual({ events: [{ ...click, action: "unknown", code: null }], errors: [] });
	});

	it("passes the amended codes through unchanged", () => {
		const codes = ["UserIntervened", "AxUnconfirmed", "SpaceUnsupported", "SpaceMoveDenied"];
		const seen = codes.map((code) => dispatchAudit({ ...click, code }).events[0]?.code);
		expect(seen).toEqual(codes);
	});

	it("still reports a structurally malformed event", () => {
		const { events, errors } = dispatchAudit({ ...click, durationMs: "3" });
		expect({ events: events.length, errors: errors.map((error) => error.message) }).toEqual({
			events: 0,
			errors: ['desktop engine notification "audit" is malformed'],
		});
	});
});

describe("error data from a newer engine", () => {
	it("reads an amended code as itself and an unknown code as no data", () => {
		expect(parseErrorData({ code: "UserIntervened", hint: null })).toEqual({ code: "UserIntervened", hint: null });
		expect(parseErrorData({ code: "SomeFutureCode", hint: null })).toBeNull();
	});
});

describe("capabilities across releases", () => {
	const capabilities = {
		backend: "fake",
		capture: true,
		input: true,
		ax: true,
		backgroundWindowInput: true,
		deliveryModes: ["background"],
		capturePermission: "granted",
		inputPermission: "granted",
		axPermission: "granted",
		displayCount: 1,
		focusGuard: true,
		stopPath: "global",
		screenLocked: false,
	};

	it("accepts capabilities with and without interventionWatch and displayAsleep", () => {
		const newer = { ...capabilities, interventionWatch: "on", displayAsleep: false };
		expect([isDesktopCapabilities(capabilities), isDesktopCapabilities(newer)]).toEqual([true, true]);
	});

	it("rejects mistyped interventionWatch or displayAsleep", () => {
		const wrong = [{ ...capabilities, interventionWatch: true }, { ...capabilities, displayAsleep: "no" }];
		expect(wrong.map((value) => isDesktopCapabilities(value))).toEqual([false, false]);
	});
});
