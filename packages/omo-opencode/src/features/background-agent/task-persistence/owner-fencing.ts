interface ErrnoException extends Error {
	code?: string;
}

function isErrnoException(error: unknown): error is ErrnoException {
	return error instanceof Error && "code" in error;
}

/**
 * Stamps the current process owner information.
 *
 * @returns An object containing the current process PID and the start timestamp in ISO format.
 */
export function stampOwner(): { pid: number; startedAt: string } {
	return {
		pid: process.pid,
		startedAt: new Date().toISOString(),
	};
}

/**
 * Checks if a process with the given PID is currently alive.
 *
 * @param pid - The process ID to check. Must be a positive integer.
 * @param deps - Optional dependencies for dependency injection.
 * @param deps.kill - A function to send a signal to a process. Defaults to process.kill.
 * @returns True if the process is alive or if we cannot determine (e.g., due to permission errors), false otherwise.
 *
 * @remarks
 * **Limitations:**
 * 1. **PID Recycling:** PID recycling is not fully detectable. If a process dies and its PID is reassigned
 *    to a new process before this check, it will incorrectly report the process as alive. This is an accepted
 *    limitation of PID-based fencing. The owning snapshot records `owner.startedAt` precisely so a future
 *    refinement can compare the recorded start time against the live process start time and reject a recycled
 *    pid; today fencing is pid-liveness only and does not yet consult `owner.startedAt`. The direction is
 *    deliberately conservative: a falsely-"alive" owner only causes recovery to skip adoption, never to corrupt
 *    or steal a task another process may legitimately own.
 * 2. **Windows Semantics:** On Windows, `process.kill(pid, 0)` semantics differ from POSIX systems. Specifically,
 *    sending signal 0 is not supported in the same way and may throw or behave differently.
 *    Using dependency injection (`deps.kill`) keeps the policy unit-testable and cross-platform.
 */
export function isPidAlive(
	pid: number,
	deps?: { kill?: (pid: number, signal: number) => unknown },
): boolean {
	if (pid <= 0 || !Number.isInteger(pid)) {
		return false;
	}

	const killFn = deps?.kill ?? process.kill;

	try {
		killFn(pid, 0);
		return true;
	} catch (error) {
		if (isErrnoException(error)) {
			if (error.code === "ESRCH") {
				return false;
			}
			if (error.code === "EPERM") {
				return true;
			}
		}
		return false;
	}
}
