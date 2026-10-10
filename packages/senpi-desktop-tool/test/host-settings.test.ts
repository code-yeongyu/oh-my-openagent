import { describe, expect, it } from "vitest";
import { isSupportedHost } from "../src/host-policy";
import { ComputerSettingsError, resolveComputerSettings } from "../src/settings";

describe("isSupportedHost", () => {
	it.each(["darwin", "linux", "win32"])("supports %s", (platform) => {
		// Given: a platform with a desktop backend.
		// When
		const supported = isSupportedHost(platform);

		// Then
		expect(supported).toBe(true);
	});

	it("does not support freebsd", () => {
		// Given
		const platform = "freebsd";

		// When
		const supported = isSupportedHost(platform);

		// Then
		expect(supported).toBe(false);
	});
});

describe("resolveComputerSettings", () => {
	it.each(["darwin", "linux", "win32"])("enables the virtual cursor by default on %s", (platform) => {
		// Given: no cursor override.
		// When: settings are resolved for a supported host.
		const settings = resolveComputerSettings(undefined, platform);
		// Then: the default is enabled, even where the overlay itself is unavailable.
		expect(Reflect.get(settings, "showCursor")).toBe(true);
	});

	it("keeps an explicit virtual cursor off switch", () => {
		// Given: the user has disabled the overlay.
		const raw = { showCursor: false };
		// When
		const settings = resolveComputerSettings(raw, "darwin");
		// Then: disabling the overlay does not disable computer use.
		expect(Reflect.get(settings, "showCursor")).toBe(false);
		expect(settings.enabled).toBe(true);
	});

	it("fills every default when the computer block is absent", () => {
		// Given
		const raw = undefined;

		// When
		const settings = resolveComputerSettings(raw, "darwin");

		// Then
		expect(settings).toEqual({
			enabled: true,
			showCursor: true,
			display: "all",
			maxWidth: 3840,
			maxHeight: 2400,
			screenshotMaxBytes: 5_000_000,
			stopHotkey: "ctrl+alt+cmd+escape",
			allowHostRelayOnlyStop: false,
			macosCanary: "session",
			auditLog: { enabled: true },
			screenshotGc: { enabled: true, staleMs: 43_200_000, scanIntervalMs: 1_800_000 },
			enginePath: undefined,
			cuaAdapter: false,
		});
	});

	it("defaults enabled off on an unsupported host", () => {
		// Given
		const raw = {};

		// When
		const settings = resolveComputerSettings(raw, "freebsd");

		// Then
		expect({ enabled: settings.enabled, stopHotkey: settings.stopHotkey }).toEqual({
			enabled: false,
			stopHotkey: "ctrl+alt+shift+escape",
		});
	});

	it("keeps explicit values over the host defaults", () => {
		// Given
		const raw = { enabled: false, stopHotkey: "ctrl+alt+shift+f12", screenshotGc: { staleMs: 60_000 } };

		// When
		const settings = resolveComputerSettings(raw, "darwin");

		// Then
		expect({ enabled: settings.enabled, stopHotkey: settings.stopHotkey, gc: settings.screenshotGc }).toEqual({
			enabled: false,
			stopHotkey: "ctrl+alt+shift+f12",
			gc: { enabled: true, staleMs: 60_000, scanIntervalMs: 1_800_000 },
		});
	});

	it("rejects an unknown key and a wrongly typed value", () => {
		// Given
		const raw = { maxWidth: "wide", stopChord: "ctrl+escape" };

		// When
		const parse = () => resolveComputerSettings(raw, "linux");

		// Then
		expect(parse).toThrow(ComputerSettingsError);
	});
});
