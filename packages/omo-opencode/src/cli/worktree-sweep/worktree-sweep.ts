import { formatResult } from "./format"
import { sweepWorktrees } from "./sweep"
import type { WorktreeSweepOptions } from "./types"

export async function worktreeSweep(options: WorktreeSweepOptions = {}): Promise<number> {
  let result
  try {
    result = await sweepWorktrees(options)
  } catch (error) {
    process.stderr.write(
      `[omo] worktree-sweep failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }

  if (options.json === true) {
    process.stdout.write(JSON.stringify(result, null, 2))
    process.stdout.write("\n")
  } else {
    process.stdout.write(formatResult(result).join("\n"))
    process.stdout.write("\n")
  }

  const failedTotal = result.repos.reduce((total, repo) => total + repo.failed.length, 0)
  if (failedTotal > 0) return 1
  return 0
}
