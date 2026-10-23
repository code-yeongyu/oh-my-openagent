import { describeAgreementsToolViolation } from "../agreements/guard"
import { readAgreementsAt, readAgreementsWorktree } from "../agreements/ledger-file"
import { AGREEMENTS_PATH } from "../agreements/types"
import type { GitMemoryRepo } from "../git"

export async function refuseAgreementsViolation(repo: GitMemoryRepo, paths: readonly string[]): Promise<string | undefined> {
  if (!paths.includes(AGREEMENTS_PATH)) return undefined
  const head = await repo.head()
  const before = head === null ? undefined : await readAgreementsAt(repo, head)
  const violation = describeAgreementsToolViolation(before, await readAgreementsWorktree(repo.dir))
  if (violation !== undefined) await repo.restorePaths(paths)
  return violation
}
