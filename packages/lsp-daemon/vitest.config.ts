import { defineConfig } from "vitest/config";

/**
 * Per-test budget for the whole package.
 *
 * This MUST strictly exceed `MAX_IN_TEST_BUDGET_MS`: a test that grants its own
 * child process N ms cannot pass if the harness kills the test before that
 * child's guard can fire, so the inner guard becomes unreachable and a
 * slow-but-correct subprocess reports as `Test timed out` instead of the real
 * assertion. Windows CI runners routinely spend >5s spawning `bun`, which is
 * how the vitest 5s default turned correct tests red.
 *
 * 30s leaves a cold Windows `bun` child several times its normal run, still
 * low enough that a genuine hang fails the job in seconds rather than sitting
 * until the workflow-level timeout.
 */
export const TEST_TIMEOUT_MS = 30_000;

/**
 * Time a test keeps after its subprocess ceiling fires: enough to kill the child
 * and fail with a named error carrying the child's output before the harness
 * budget above ends.
 */
const SUBPROCESS_REPORT_MARGIN_MS = 5_000;

/**
 * Largest budget any test in this package grants a subprocess or a timed
 * promise guard: the ceiling `test/bun-child.ts` gives every `bun` child it runs.
 *
 * It is derived from the harness budget instead of being a clock of its own. A
 * fixed 10s clock around a cold `bun` child failed slow-but-correct runs on a
 * loaded Windows runner, where one full cancellation-smoke run measured ~9s and
 * the next one was killed at 10s with empty output (#11700).
 */
export const MAX_IN_TEST_BUDGET_MS = TEST_TIMEOUT_MS - SUBPROCESS_REPORT_MARGIN_MS;

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		pool: "threads",
		testTimeout: TEST_TIMEOUT_MS,
		hookTimeout: TEST_TIMEOUT_MS,
	},
});
