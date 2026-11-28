import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter } from "node:path"

// A fixture's git command run in a temp dir that is not yet its own repository otherwise discovers whatever
// repository encloses TMPDIR, and its config writes, commits and pushes land there (#12265). Git never walks up
// into a ceiling directory, so every test child stops discovery at the temp root it creates fixtures under.
export function installGitDiscoveryCeiling(): void {
  const root = tmpdir()
  const ceilings = [...new Set([root, realpathSync.native(root)])].join(delimiter)
  const existing = process.env.GIT_CEILING_DIRECTORIES
  process.env.GIT_CEILING_DIRECTORIES = existing === undefined || existing === "" ? ceilings : `${ceilings}${delimiter}${existing}`
}
