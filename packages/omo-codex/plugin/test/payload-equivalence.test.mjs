import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

const TELEMETRY_CORE_PACKAGE = "@oh-my-opencode/telemetry-core";
const telemetryCoreRoot = join(root, "..", "..", "telemetry-core");

function createOsProvider() {
	return {
		arch: () => "arm64",
		cpus: () => [{ model: "Test CPU" }],
		hostname: () => "task-15-host",
		platform: () => "darwin",
		release: () => "26.0.0",
		totalmem: () => 16 * 1024 * 1024 * 1024,
		type: () => "Darwin",
	};
}

function createTransportRecorder(capturedMessages) {
	return {
		factory: () => ({
			capture: (message) => {
				capturedMessages.push(message);
			},
			flush: async () => undefined,
			shutdown: async () => undefined,
		}),
	};
}

async function readTelemetryCoreDefaultPostHogConstants() {
	const constantsSource = await readFile(join(telemetryCoreRoot, "src", "constants.ts"), "utf8");
	const host = constantsSource.match(/DEFAULT_POSTHOG_HOST = "([^"]+)"/)?.[1];
	const apiKey = constantsSource.match(/DEFAULT_POSTHOG_API_KEY = "([^"]+)"/)?.[1];
	assert.equal(host, "https://us.i.posthog.com");
	assert.match(apiKey ?? "", /^phc_/);
	return { apiKey, host };
}

test("payload-equivalence: #given telemetry-core and component shim #when session_start is captured #then payload schema matches telemetry-core", async () => {
	const stateDir = mkdtempSync(join(tmpdir(), "omo-codex-payload-equivalence-"));
	const savedTermProgram = process.env.TERM_PROGRAM;
	process.env.TERM_PROGRAM = "/home/sentinel-user/bin/x";
	const previousShell = process.env.SHELL;
	// A login shell path can carry the user's name; only the program name may be sent.
	process.env.SHELL = "/home/payload-user/.nix-profile/bin/zsh";
	try {
		await readTelemetryCoreDefaultPostHogConstants();
		const componentPostHog = await import("../components/telemetry/dist/posthog.js");
		assert.equal(typeof componentPostHog.__createPluginPostHogForTesting, "function");
		const componentMessages = [];
		const componentRecorder = createTransportRecorder(componentMessages);

		const componentClient = componentPostHog.__createPluginPostHogForTesting({
			env: { POSTHOG_API_KEY: "test-api-key" },
			now: new Date("2026-06-12T01:02:03.000Z"),
			osProvider: createOsProvider(),
			stateDir,
			transportFactory: componentRecorder.factory,
		});
		componentClient.trackActive("session_start");
		await componentClient.shutdown();
		const installId = readFileSync(join(stateDir, "install-id"), "utf8").trim();
		assert.match(installId, /^[0-9a-f]{64}$/);
		const expectedDistinctId = createHash("sha256").update(installId).digest("hex");

		assert.deepEqual(componentMessages, [
			{
				distinctId: expectedDistinctId,
				event: "omo_codex_daily_active",
				properties: {
					$os: "darwin",
					$os_version: "26.0.0",
					$process_person_profile: false,
					ci: Boolean(process.env.CI),
					cpu_count: 1,
					cpu_model: "Test CPU",
					day_utc: "2026-06-12",
					locale: Intl.DateTimeFormat().resolvedOptions().locale,
					os_arch: "arm64",
					os_type: "Darwin",
					package_name: "@oh-my-opencode/omo-codex",
					package_version: componentPostHog.getComponentVersion(),
					platform: "omo-codex",
					product_name: "omo-codex",
					reason: "session_start",
					runtime: "node",
					runtime_version: process.version,
					shell: "zsh",
					source: "plugin",
					terminal: "other",
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					total_memory_gb: 16,
				},
			},
		]);
		assert.doesNotMatch(JSON.stringify(componentMessages), /sentinel-user/);
	} finally {
		if (savedTermProgram === undefined) delete process.env.TERM_PROGRAM;
		else process.env.TERM_PROGRAM = savedTermProgram;
		if (previousShell === undefined) delete process.env.SHELL;
		else process.env.SHELL = previousShell;
		rmSync(stateDir, { recursive: true, force: true });
	}
});

test("payload-equivalence: #given built telemetry CLI #when inspected #then telemetry-core is bundled without runtime package imports", async () => {
	const bundle = await readFile(join(root, "components", "telemetry", "dist", "cli.js"), "utf8");

	assert.doesNotMatch(bundle, new RegExp(`from ["']${TELEMETRY_CORE_PACKAGE}`));
	assert.doesNotMatch(bundle, new RegExp(`import\\(["']${TELEMETRY_CORE_PACKAGE}`));
	assert.match(bundle, /omo_codex_daily_active/);
	assert.match(bundle, /posthog-activity\.json/);
});
