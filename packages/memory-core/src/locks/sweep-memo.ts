// Directory hygiene runs on a process's first acquisition in a directory and again once the
// interval has passed, so a long-lived host keeps reclaiming what crashed neighbours leave behind.
export const LOCK_DIRECTORY_SWEEP_INTERVAL_MS = 10 * 60 * 1000
const sweptLockDirectories = new Map<string, number>()

/** True, and the directory is marked swept at `at`, when its hygiene is due. */
export function claimDirectorySweep(lockDirectory: string, at: number): boolean {
  const lastSwept = sweptLockDirectories.get(lockDirectory)
  if (lastSwept !== undefined && at - lastSwept < LOCK_DIRECTORY_SWEEP_INTERVAL_MS) return false
  sweptLockDirectories.set(lockDirectory, at)
  return true
}

/** A candidate this process could not remove: sweep the directory again on the next acquisition. */
export function rearmCandidateSweep(lockDirectory: string): void {
  sweptLockDirectories.delete(lockDirectory)
}
