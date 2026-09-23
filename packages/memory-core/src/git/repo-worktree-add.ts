import { isGitWorktreeMetadataRaceError } from "./config-lock"

const ATTEMPTS = 5
const BASE_DELAY_MS = 25

export interface WorktreeAddRequest {
  readonly path: string
  readonly branch: string
  readonly startPoint: string
}

export interface WorktreeAddHandlers {
  readonly execute: (argv: readonly string[]) => Promise<void>
  readonly branchExists: () => Promise<boolean>
}

/**
 * Runs `git worktree add`, retrying the transient cross-process commondir race
 * from issue #6852. A torn attempt leaves its branch ref behind with no worktree,
 * so once the ref exists the retry checks out that branch instead of passing -b
 * and dying on "branch already exists". Any other failure rethrows untouched.
 */
export async function addWorktreeWithRetry(
  request: WorktreeAddRequest,
  handlers: WorktreeAddHandlers,
): Promise<void> {
  let createBranch = true
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const argv = createBranch
      ? ["worktree", "add", "-b", request.branch, request.path, request.startPoint]
      : ["worktree", "add", request.path, request.branch]
    try {
      await handlers.execute(argv)
      return
    } catch (error) {
      if (!isGitWorktreeMetadataRaceError(error) || attempt === ATTEMPTS) throw error
      if (createBranch && (await handlers.branchExists())) createBranch = false
      await delay(BASE_DELAY_MS * 2 ** (attempt - 1))
    }
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
}
