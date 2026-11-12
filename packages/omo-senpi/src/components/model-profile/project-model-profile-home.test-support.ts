import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"

export const COMMENTED = `// project omo config
{
  // keep me
  "side_panel": { "enabled": true }
}
`

export function folder(content?: string): string {
  const cwd = realpathSync(testTempDir("omo-project-model-profile-home-"))
  if (content !== undefined) {
    mkdirSync(join(cwd, ".omo"))
    writeFileSync(join(cwd, ".omo", "omo.jsonc"), content)
  }
  return cwd
}

export const trusted = (cwd: string) => ({ cwd, isProjectTrusted: () => true })
export const configText = (cwd: string) => readFileSync(join(cwd, ".omo", "omo.jsonc"), "utf8")

// The engine runs as another account than the one owning the folder (a root or service engine), so the owner's home is
// looked up besides this account's own.
export function asAnotherAccount<T>(cwd: string, body: () => T): T {
  const original = process.getuid
  process.getuid = () => statSync(cwd).uid + 1
  try {
    return body()
  } finally {
    if (original === undefined) delete process.getuid
    else process.getuid = original
  }
}
