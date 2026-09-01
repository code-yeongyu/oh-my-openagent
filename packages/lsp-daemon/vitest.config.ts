import { defineConfig } from "vitest/config";

/**
 * Largest budget any test in this package grants a subprocess or a timed
 * promise guard. Currently `test/qa-driver-portability.test.ts`, which gives the
 * `bun` cancellation smoke 10s both as an `execFileSync` timeout and as a
 * `setTimeout` guard around its `spawn`.
 */
export const MAX_IN_TEST_BUDGET_MS = 10_000;

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
 * 30s is deliberately only 3x the largest inner budget: enough headroom for a
 * cold Windows process spawn on top of a 10s guard, still low enough that a
 * genuine hang fails the job in seconds rather than sitting until the
 * workflow-level timeout.
 */
export const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		pool: "threads",
		testTimeout: TEST_TIMEOUT_MS,
		hookTimeout: TEST_TIMEOUT_MS,
	},
});
