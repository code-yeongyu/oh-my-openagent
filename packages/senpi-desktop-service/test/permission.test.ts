import { expect, it } from "vitest";
import { DesktopEngineRpcError } from "../src/service/rpc-client";
import { isStopPathStatus, parseErrorData } from "../src/service/parse";

const permission = {
	permission: "accessibility",
	settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
	app: "QA App",
	relaunchRequired: true,
} as const;

it("decodes typed permission guidance without losing the engine message", () => {
	const data = { code: "PermissionDenied", hint: null, permission };
	const error = new DesktopEngineRpcError("click", { code: -32000, message: "engine diagnostic", data });
	expect(error.data).toEqual(data);
	expect(error.message).toBe("engine diagnostic");
});

it.each([
	{ ...permission, permission: "unknown" },
	{ ...permission, settingsUrl: 4 },
	{ ...permission, app: null },
	{ ...permission, relaunchRequired: "true" },
])("does not expose malformed permission metadata: %j", (invalid) => {
	expect(parseErrorData({ code: "PermissionDenied", permission: invalid }))
		.toEqual({ code: "PermissionDenied", hint: null });
});

it("keeps legacy errors and method rejections compatible", () => {
	expect(parseErrorData({ code: "PermissionDenied", hint: "old" }))
		.toEqual({ code: "PermissionDenied", hint: "old" });
	expect(parseErrorData({ reason: "hostOnly" })).toEqual({ reason: "hostOnly" });
});

it("accepts the accessibility-denied stop-path status", () => {
	expect(isStopPathStatus({
		suspended: false, globalLive: false, hostRelayLive: true, heartbeatFresh: true,
		stopPath: "host-relay", reason: "accessibility-denied",
	})).toBe(true);
});
