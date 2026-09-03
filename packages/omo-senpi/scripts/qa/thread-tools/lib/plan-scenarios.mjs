import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Cross-surface lane planning for thread-tools/run-all.mjs.
 *
 * The desktop-backed lanes import the private desktop checkout through the
 * harness (DESKTOP_ROOT/apps/server). Outside a maintainer machine that checkout
 * never exists, so spawning them can only fail at module resolution, never at an
 * assertion - and terminal-to-ui starts a real socket host before it gets there.
 * Planning marks those lanes "skip" (or "fail" when the caller demands them via
 * THREAD_QA_REQUIRE_DESKTOP) and run-all never spawns a skipped lane.
 */

export const SCENARIOS = Object.freeze([
	Object.freeze({ name: "cli-surface", file: "cli-surface.mjs", needsDesktop: false }),
	Object.freeze({ name: "desktop-client", file: "desktop-client.mjs", needsDesktop: true }),
	Object.freeze({ name: "terminal-to-ui", file: "terminal-to-ui.mjs", needsDesktop: true }),
	Object.freeze({ name: "desktop-to-cli", file: "desktop-to-cli.mjs", needsDesktop: true }),
]);

/** Default desktop checkout, kept in one place for the harness and the planner. */
export const DEFAULT_DESKTOP_ROOT = "/Users/yeongyu/local-workspaces/omo-desktop-thread-tools";

/**
 * The one file every desktop checkout must have: the harness anchors its desktop
 * createRequire() at it. createRequire never checks existence, so planning does.
 */
export const DESKTOP_MARKER_PATH = join("apps", "server", "package.json");

const REQUIRE_DESKTOP_ENV = "THREAD_QA_REQUIRE_DESKTOP";
const TRUTHY = new Set(["1", "true", "yes"]);

/** @param {Record<string, string | undefined>} env */
export function resolveDesktopRoot(env) {
	return env.THREAD_QA_DESKTOP_ROOT ?? DEFAULT_DESKTOP_ROOT;
}

/** @param {Record<string, string | undefined>} env */
function requiresDesktop(env) {
	return TRUTHY.has((env[REQUIRE_DESKTOP_ENV] ?? "").trim().toLowerCase());
}

/**
 * @param {{ desktopRoot: string, env: Record<string, string | undefined> }} input
 * @returns {Array<{ name: string, file: string, needsDesktop: boolean, mode: "run" | "skip" | "fail", reason?: string }>}
 */
export function planScenarios({ desktopRoot, env }) {
	if (existsSync(join(desktopRoot, DESKTOP_MARKER_PATH))) {
		return SCENARIOS.map((scenario) => ({ ...scenario, mode: "run" }));
	}
	const missing = `desktop root ${desktopRoot} has no ${DESKTOP_MARKER_PATH}`;
	const hardFail = requiresDesktop(env);
	return SCENARIOS.map((scenario) => {
		if (!scenario.needsDesktop) return { ...scenario, mode: "run" };
		if (hardFail) return { ...scenario, mode: "fail", reason: `${missing} but ${REQUIRE_DESKTOP_ENV} requires the desktop lanes` };
		return { ...scenario, mode: "skip", reason: `${missing}; set THREAD_QA_DESKTOP_ROOT to a desktop checkout to run this lane` };
	});
}

/**
 * @param {Array<{ name: string, mode: "run" | "skip" | "fail", code?: number, reason?: string }>} results
 * @returns {{ failed: string[], skipped: string[], lines: string[], exitCode: 0 | 1 }}
 */
export function summarize(results) {
	const failed = [];
	const skipped = [];
	const lines = [];
	for (const result of results) {
		if (result.mode === "skip") {
			skipped.push(result.name);
			lines.push(`SKIP ${result.name} (${result.reason})`);
			continue;
		}
		if (result.mode === "fail") {
			failed.push(result.name);
			lines.push(`FAIL ${result.name} (${result.reason})`);
			continue;
		}
		const ok = result.code === 0;
		if (!ok) failed.push(result.name);
		lines.push(`${ok ? "PASS" : "FAIL"} ${result.name} exit=${result.code}`);
	}
	lines.push(
		`${failed.length === 0 ? "PASS" : "FAIL"} run-all failed_scenarios=${failed.length} skipped_scenarios=${skipped.length}`,
	);
	return { failed, skipped, lines, exitCode: failed.length === 0 ? 0 : 1 };
}
