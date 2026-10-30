import { runPythonFacade } from "./harness";

/**
 * Starts the Python interpreter once, through the same facade harness the tests use, before any test deadline
 * runs. The tests check facade semantics; the interpreter's first start (a cold OS file cache or an antivirus
 * scan of the interpreter and its standard library on a fresh CI runner) is test infrastructure, and a missing
 * or broken interpreter fails the whole run here with the interpreter's own error.
 */
export default function setup(): void {
	const run = runPythonFacade("out = 'ready'");
	if (run.out !== "ready") throw new Error(`The Python facade harness did not start: ${JSON.stringify(run)}`);
}
