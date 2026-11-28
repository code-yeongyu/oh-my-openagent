import type { GitMemoryRepo } from "../git"
import { MemoryToolError } from "./tool-errors"

// A commit that failed without landing (a hook failure, a timed-out commit that did not land, a full disk) must not leave
// its applied and staged change behind, or every later write is refused as "uncommitted changes" (#15411). A commit that
// timed out but landed never reaches here: the commit path judges it by what landed and returns normally.
export async function undoFailedCommit(
  repo: GitMemoryRepo,
  paths: readonly string[],
  failure: unknown,
): Promise<never> {
  try {
    await repo.restorePaths(paths)
  } catch (restoreError) {
    const failed = failure instanceof Error ? failure.message : String(failure)
    const reason = restoreError instanceof Error ? restoreError.message : String(restoreError)
    throw new MemoryToolError(
      `${failed}\nThe change this write made could not be undone (${reason}); before retrying, restore or remove: ${paths.join(", ")}`,
      { cause: new AggregateError([failure, restoreError]) },
    )
  }
  throw failure
}
