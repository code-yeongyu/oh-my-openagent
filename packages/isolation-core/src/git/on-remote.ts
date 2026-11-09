import { captureRepoBaseline, type WorktreeBaseline } from "./baseline"
import { runGit } from "./command"

/**
 * Whether everything a settled child left in its clone already exists on one of the clone's remotes,
 * so the clone holds nothing a person could lose: no staged or unstaged edit, no untracked file the
 * source checkout did not already have (same content), and a HEAD that a remote-tracking ref reaches.
 *
 * Conservative by design: a clone with nested repositories, or any git error, answers false and keeps
 * being retained. Only the root repository is judged.
 */
export async function isolatedWorkIsOnRemote(isolationDir: string, baseline: WorktreeBaseline): Promise<boolean> {
  if (baseline.nested.length > 0) return false
  try {
    const current = await captureRepoBaseline(isolationDir)
    if (current.staged !== "" || current.unstaged !== "") return false
    if (current.untrackedPatch !== baseline.root.untrackedPatch) return false
    if (current.headCommit === "") return false
    // With no remote-tracking refs `--not --remotes` excludes nothing, so a clone that never fetched
    // lists its HEAD here and is kept.
    const unpushed = await runGit(["rev-list", "--max-count=1", "HEAD", "--not", "--remotes"], { cwd: isolationDir })
    return unpushed.stdout.toString().trim() === ""
  } catch {
    return false
  }
}
