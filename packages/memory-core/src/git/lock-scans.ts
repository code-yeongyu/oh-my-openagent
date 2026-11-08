import { findOpenFileHolderPids } from "./open-file-holders"
import { findProcessesWorkingIn } from "./repo-in-use"

// The two host scans every stranded-git-lock decision rests on. `null` means the host could not
// answer (for example same-uid processes whose /proc entries cannot be read), and every caller
// treats it as "in use": an unanswerable scan never authorizes removing a lock (omo #10199).
export interface GitLockScans {
  readonly findHolders: (lockPath: string) => Promise<readonly number[] | null>
  readonly findRepoUsers: (repoDir: string) => Promise<readonly number[] | null>
}

export const PRODUCTION_LOCK_SCANS: GitLockScans = {
  findHolders: (lockPath) => findOpenFileHolderPids(lockPath),
  findRepoUsers: (repoDir) => findProcessesWorkingIn(repoDir),
}
