import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	cleanupTelemetryDiagnostics,
} from "@oh-my-opencode/telemetry-core";
import {
	getComponentTelemetryDiagnosticsFilePath,
	getComponentTelemetryStateDir,
	writeComponentTelemetryDiagnostic,
} from "../src/product-identity.js";
import { CACHE_DIR_NAME } from "../src/product-identity.js";

const originalXdgDataHome = process.env["XDG_DATA_HOME"];
const tempDirectories: string[] = [];

function createDataHomePath(): string {
	const tempPath = mkdtempSync(path.join(tmpdir(), "codex-telemetry-diagnostics-"));
	tempDirectories.push(tempPath);
	return tempPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDiagnosticEntries(filePath: string): ReadonlyArray<Record<string, unknown>> {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => {
			const parsed: unknown = JSON.parse(line);
			if (!isRecord(parsed)) {
				throw new Error("diagnostic line must be a JSON object");
			}
			return parsed;
		});
}

afterEach(() => {
	if (originalXdgDataHome === undefined) {
		delete process.env["XDG_DATA_HOME"];
	} else {
		process.env["XDG_DATA_HOME"] = originalXdgDataHome;
	}

	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("telemetry diagnostics", () => {
	it("#given a telemetry failure #when diagnostics are written #then JSONL is stored under the omo-codex data directory", () => {
		const dataHomePath = createDataHomePath();
		process.env["XDG_DATA_HOME"] = dataHomePath;

		writeComponentTelemetryDiagnostic(
			{
				event: "telemetry_capture_failed",
				error: new Error("capture failed"),
				source: "plugin",
			},
			new Date("2026-06-04T01:02:03.000Z"),
		);

		const diagnosticsFilePath = getComponentTelemetryDiagnosticsFilePath();
		expect(diagnosticsFilePath).toBe(path.join(dataHomePath, CACHE_DIR_NAME, "telemetry-diagnostics.jsonl"));

		const entries = readDiagnosticEntries(diagnosticsFilePath);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			timestamp: "2026-06-04T01:02:03.000Z",
			event: "telemetry_capture_failed",
			source: "plugin",
			error_name: "Error",
			error_message: "capture failed",
		});
	});

	it("#given stale diagnostics #when cleanup runs #then stale rows are pruned and future writes still append", () => {
		const dataHomePath = createDataHomePath();
		process.env["XDG_DATA_HOME"] = dataHomePath;
		const diagnosticsDir = path.join(dataHomePath, CACHE_DIR_NAME);
		const diagnosticsFilePath = path.join(diagnosticsDir, "telemetry-diagnostics.jsonl");
		mkdirSync(diagnosticsDir, { recursive: true });
		writeFileSync(
			diagnosticsFilePath,
			`${[
				JSON.stringify({
					timestamp: "2026-05-01T00:00:00.000Z",
					event: "telemetry_capture_failed",
					source: "plugin",
				}),
				JSON.stringify({
					timestamp: "2026-06-03T00:00:00.000Z",
					event: "telemetry_shutdown_failed",
					source: "plugin",
				}),
			].join("\n")}\n`,
		);

		cleanupTelemetryDiagnostics({
			diagnosticsDir: getComponentTelemetryStateDir(),
			now: new Date("2026-06-04T00:00:00.000Z"),
		});
		writeComponentTelemetryDiagnostic(
			{
				event: "telemetry_capture_failed",
				error: new Error("next failure"),
				source: "plugin",
			},
			new Date("2026-06-04T00:01:00.000Z"),
		);

		expect(existsSync(diagnosticsFilePath)).toBe(true);
		const entries = readDiagnosticEntries(diagnosticsFilePath);
		expect(entries.map((entry) => entry["timestamp"])).toEqual([
			"2026-06-03T00:00:00.000Z",
			"2026-06-04T00:01:00.000Z",
		]);
	});
});
