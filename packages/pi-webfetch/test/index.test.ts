import { describe, expect, it, mock } from "bun:test";
import webfetchExtension, { isWebfetchEnabled } from "../src/index.js";

const ENABLE_ENV = "PI_WEBFETCH";

describe("webfetch extension toggle", () => {
	it("returns true when PI_WEBFETCH is unset", () => {
		delete process.env[ENABLE_ENV];
		expect(isWebfetchEnabled()).toBe(true);
	});

	it.each(["1", "true", "yes", "on", " TRUE ", "\tYeS\n"])(
		"returns true for truthy PI_WEBFETCH value %s",
		(envValue) => {
			process.env[ENABLE_ENV] = envValue;
			expect(isWebfetchEnabled()).toBe(true);
		},
	);

	it.each(["0", "false", "no", "off", " OFF ", "\nNo\t"])(
		"returns false for falsy PI_WEBFETCH value %s",
		(envValue) => {
			process.env[ENABLE_ENV] = envValue;
			expect(isWebfetchEnabled()).toBe(false);
		},
	);

	it("returns true for unknown PI_WEBFETCH values", () => {
		process.env[ENABLE_ENV] = "definitely";
		expect(isWebfetchEnabled()).toBe(true);
	});

	it("is a no-op when PI_WEBFETCH is disabled", () => {
		process.env[ENABLE_ENV] = "0";
		const registerTool = mock();
		webfetchExtension({ registerTool } as never);
		expect(registerTool).not.toHaveBeenCalled();
	});

	it("registers the webfetch tool when PI_WEBFETCH is unset", () => {
		delete process.env[ENABLE_ENV];
		const registerTool = mock();
		webfetchExtension({ registerTool, on: mock() } as never);
		expect(registerTool).toHaveBeenCalledTimes(1);
	});

	it("#given interactive session #when webfetch starts #then clears startup widget", async () => {
		// given
		delete process.env[ENABLE_ENV];
		const registerTool = mock();
		let sessionStart: ((event: object, ctx: object) => Promise<void> | void) | undefined;
		const setWidget = mock();
		const setStatus = mock();

		// when
		webfetchExtension({
			registerTool,
			on(eventName: string, handler: unknown) {
				if (eventName === "session_start") {
					sessionStart = handler as typeof sessionStart;
				}
			},
		} as never);
		await sessionStart?.(
			{},
			{
				hasUI: true,
				ui: {
					setWidget,
					setStatus,
					theme: { fg: (_key: string, value: string) => value },
				},
			},
		);

		// then
		expect(setStatus).toHaveBeenCalledWith("pi-webfetch", undefined);
		expect(setWidget).toHaveBeenCalledWith("pi-webfetch", undefined);
	});
});
