import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isTelemetryClientEnabled } from "../../../telemetry-core/src/injected-client.ts";
import { createOmoNativeProductConfig } from "../../src/components/telemetry/product-identity.ts";
import { prepareCaseSandbox } from "./fused-equivalence-sandbox.mjs";

const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A run as the senpi harness's startCaseRun hands it over: its env opts out of senpi's telemetry only. */
function harnessRun() {
	const dir = mkdtempSync(join(tmpdir(), "eq-omo-sandbox-"));
	roots.push(dir);
	const box = { dir, agentDir: join(dir, "agent"), cwd: join(dir, "work") };
	mkdirSync(box.agentDir, { recursive: true });
	mkdirSync(box.cwd, { recursive: true });
	return { box, childPath: "/usr/bin:/bin", env: { HOME: dir, PI_OFFLINE: "1", PI_TELEMETRY: "0" } };
}

const pluginTelemetryOn = (env) => isTelemetryClientEnabled({ env, product: createOmoNativeProductConfig() });

describe("prepareCaseSandbox", () => {
	test("#given the harness env, which leaves the plugin's telemetry on #when a case sandbox is prepared #then the CLI child's plugin telemetry is off", () => {
		const run = harnessRun();
		expect(pluginTelemetryOn(run.env)).toBe(true);

		prepareCaseSandbox(run, {});

		expect(pluginTelemetryOn(run.env)).toBe(false);
	});

	test("#given a caller that opted the plugin in #when a case sandbox is prepared #then the opt-out still wins", () => {
		const run = harnessRun();
		run.env.DO_NOT_TRACK = "0";
		run.env.OMO_DISABLE_TELEMETRY = "0";

		prepareCaseSandbox(run, {});

		expect(pluginTelemetryOn(run.env)).toBe(false);
	});
});
