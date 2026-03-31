import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { LegacyPluginCheckResult } from "./legacy-plugin-warning";
import * as legacyPluginWarning from "./legacy-plugin-warning";
import * as logger from "./logger";
import * as migrateLegacyPluginEntryModule from "./migrate-legacy-plugin-entry";

function createLegacyPluginCheckResult(
	overrides: Partial<LegacyPluginCheckResult> = {},
): LegacyPluginCheckResult {
	return {
		hasLegacyEntry: false,
		hasCanonicalEntry: false,
		legacyEntries: [],
		configPath: null,
		...overrides,
	};
}

let consoleWarnSpy: ReturnType<typeof spyOn>;
let checkForLegacyPluginEntrySpy: ReturnType<typeof spyOn>;
let logSpy: ReturnType<typeof spyOn>;
let migrateLegacyPluginEntrySpy: ReturnType<typeof spyOn>;

async function importFreshStartupWarningModule(): Promise<
	typeof import("./log-legacy-plugin-startup-warning")
> {
	return import(
		`./log-legacy-plugin-startup-warning?test=${Date.now()}-${Math.random()}`
	);
}

describe("logLegacyPluginStartupWarning", () => {
	beforeEach(() => {
		checkForLegacyPluginEntrySpy = spyOn(
			legacyPluginWarning,
			"checkForLegacyPluginEntry",
		).mockReturnValue(createLegacyPluginCheckResult());
		logSpy = spyOn(logger, "log").mockImplementation(() => {});
		migrateLegacyPluginEntrySpy = spyOn(
			migrateLegacyPluginEntryModule,
			"migrateLegacyPluginEntry",
		).mockReturnValue(false);
		consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleWarnSpy?.mockRestore();
		checkForLegacyPluginEntrySpy?.mockRestore();
		logSpy?.mockRestore();
		migrateLegacyPluginEntrySpy?.mockRestore();
	});

	describe("#given OpenCode config contains legacy plugin entries", () => {
		it("#then logs the legacy entries with canonical replacements", async () => {
			//#given
			checkForLegacyPluginEntrySpy.mockReturnValue(
				createLegacyPluginCheckResult({
					hasLegacyEntry: true,
					legacyEntries: ["oh-my-opencode", "oh-my-opencode@3.13.1"],
					configPath: "/tmp/opencode.json",
				}),
			);
			const { logLegacyPluginStartupWarning } =
				await importFreshStartupWarningModule();

			//#when
			logLegacyPluginStartupWarning();

			//#then
			expect(logSpy).toHaveBeenCalledTimes(1);
			expect(logSpy).toHaveBeenCalledWith(
				"[OhMyOpenCodePlugin] Legacy plugin entry detected in OpenCode config",
				{
					legacyEntries: ["oh-my-opencode", "oh-my-opencode@3.13.1"],
					suggestedEntries: ["oh-my-openagent", "oh-my-openagent@3.13.1"],
					hasCanonicalEntry: false,
				},
			);
		});

		it("#then emits console.warn about the rename", async () => {
			//#given
			checkForLegacyPluginEntrySpy.mockReturnValue(
				createLegacyPluginCheckResult({
					hasLegacyEntry: true,
					legacyEntries: ["oh-my-opencode@latest"],
					configPath: "/tmp/opencode.json",
				}),
			);
			const { logLegacyPluginStartupWarning } =
				await importFreshStartupWarningModule();

			//#when
			logLegacyPluginStartupWarning();

			//#then
			expect(consoleWarnSpy).toHaveBeenCalled();
			const firstCall = consoleWarnSpy.mock.calls[0]?.[0] as string;
			expect(firstCall).toContain("oh-my-opencode");
			expect(firstCall).toContain("oh-my-openagent");
		});

		it("#then attempts auto-migration of the opencode.json", async () => {
			//#given
			checkForLegacyPluginEntrySpy.mockReturnValue(
				createLegacyPluginCheckResult({
					hasLegacyEntry: true,
					legacyEntries: ["oh-my-opencode"],
					configPath: "/tmp/opencode.json",
				}),
			);
			const { logLegacyPluginStartupWarning } =
				await importFreshStartupWarningModule();

			//#when
			logLegacyPluginStartupWarning();

			//#then
			expect(migrateLegacyPluginEntrySpy).toHaveBeenCalledWith(
				"/tmp/opencode.json",
			);
		});
	});

	describe("#given OpenCode config uses only canonical plugin entries", () => {
		it("#then does not log a startup warning", async () => {
			//#given
			const { logLegacyPluginStartupWarning } =
				await importFreshStartupWarningModule();

			//#when
			logLegacyPluginStartupWarning();

			//#then
			expect(logSpy).not.toHaveBeenCalled();
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});
	});

	describe("#given migration succeeds", () => {
		it("#then logs success message to console", async () => {
			//#given
			checkForLegacyPluginEntrySpy.mockReturnValue(
				createLegacyPluginCheckResult({
					hasLegacyEntry: true,
					legacyEntries: ["oh-my-opencode@latest"],
					configPath: "/tmp/opencode.json",
				}),
			);
			migrateLegacyPluginEntrySpy.mockReturnValue(true);
			const { logLegacyPluginStartupWarning } =
				await importFreshStartupWarningModule();

			//#when
			logLegacyPluginStartupWarning();

			//#then
			const calls = consoleWarnSpy.mock.calls.map((c) => c[0] as string);
			expect(calls.some((c) => c.includes("Auto-migrated"))).toBe(true);
		});
	});
});
