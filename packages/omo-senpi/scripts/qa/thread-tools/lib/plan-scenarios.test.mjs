import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DESKTOP_MARKER_PATH, planScenarios, summarize } from "./plan-scenarios.mjs";

function fakeRoot(withMarker) {
	const root = mkdtempSync(join(tmpdir(), "plan-scenarios-"));
	if (withMarker) {
		mkdirSync(join(root, "apps", "server"), { recursive: true });
		writeFileSync(join(root, "apps", "server", "package.json"), "{}");
	}
	return root;
}

const DESKTOP_LANES = ["desktop-client", "terminal-to-ui", "desktop-to-cli"];

describe("planScenarios", () => {
	test("marks desktop-backed lanes skip when the desktop root marker is absent", () => {
		const root = fakeRoot(false);
		try {
			const planned = planScenarios({ desktopRoot: root, env: {} });
			const byName = Object.fromEntries(planned.map((entry) => [entry.name, entry]));
			expect(byName["cli-surface"].mode).toBe("run");
			expect(byName["cli-surface"].reason).toBeUndefined();
			for (const lane of DESKTOP_LANES) {
				expect(byName[lane].mode).toBe("skip");
				expect(byName[lane].reason).toContain(DESKTOP_MARKER_PATH);
				expect(byName[lane].reason).toContain(root);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("runs every lane when the desktop root marker is present", () => {
		const root = fakeRoot(true);
		try {
			const planned = planScenarios({ desktopRoot: root, env: {} });
			expect(planned.map((entry) => entry.name).sort()).toEqual(["desktop-client", "desktop-to-cli", "terminal-to-ui", "cli-surface"].sort());
			for (const entry of planned) {
				expect(entry.mode).toBe("run");
				expect(entry.reason).toBeUndefined();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("keeps missing desktop lanes as fail under THREAD_QA_REQUIRE_DESKTOP=1", () => {
		const root = fakeRoot(false);
		try {
			const planned = planScenarios({ desktopRoot: root, env: { THREAD_QA_REQUIRE_DESKTOP: "1" } });
			const byName = Object.fromEntries(planned.map((entry) => [entry.name, entry]));
			expect(byName["cli-surface"].mode).toBe("run");
			for (const lane of DESKTOP_LANES) {
				expect(byName[lane].mode).toBe("fail");
				expect(byName[lane].reason).toContain("THREAD_QA_REQUIRE_DESKTOP");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("treats truthy variants of THREAD_QA_REQUIRE_DESKTOP as set", () => {
		const root = fakeRoot(false);
		try {
			for (const value of ["1", "true", "yes"]) {
				const planned = planScenarios({ desktopRoot: root, env: { THREAD_QA_REQUIRE_DESKTOP: value } });
				expect(planned.find((entry) => entry.name === "desktop-client").mode).toBe("fail");
			}
			for (const value of ["0", "", "no", undefined]) {
				const planned = planScenarios({ desktopRoot: root, env: value === undefined ? {} : { THREAD_QA_REQUIRE_DESKTOP: value } });
				expect(planned.find((entry) => entry.name === "desktop-client").mode).toBe("skip");
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("summarize", () => {
	test("exits 0 when runs pass and skips are present", () => {
		const results = [
			{ name: "cli-surface", mode: "run", code: 0 },
			{ name: "desktop-client", mode: "skip", reason: "missing " + DESKTOP_MARKER_PATH },
		];
		const summary = summarize(results);
		expect(summary.exitCode).toBe(0);
		expect(summary.failed).toEqual([]);
		expect(summary.lines.join("\n")).toContain("SKIP desktop-client");
		expect(summary.lines.join("\n")).toContain("PASS cli-surface");
		expect(summary.skipped).toEqual(["desktop-client"]);
		expect(summary.lines.at(-1)).toBe("PASS run-all failed_scenarios=0 skipped_scenarios=1");
	});

	test("exits 1 on any failed or required-missing lane", () => {
		const results = [
			{ name: "cli-surface", mode: "run", code: 0 },
			{ name: "desktop-client", mode: "run", code: 1 },
			{ name: "terminal-to-ui", mode: "fail", reason: "required" },
		];
		const summary = summarize(results);
		expect(summary.exitCode).toBe(1);
		expect(summary.failed).toEqual(["desktop-client", "terminal-to-ui"]);
		expect(summary.skipped).toEqual([]);
		expect(summary.lines.at(-1)).toBe("FAIL run-all failed_scenarios=2 skipped_scenarios=0");
	});
});
