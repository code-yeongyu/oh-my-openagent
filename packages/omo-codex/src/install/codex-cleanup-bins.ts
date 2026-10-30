import { lstat, readFile, readdir, readlink, rm } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { COMMAND_SHIM_MARKER } from "./codex-cache-command-shim"
import { isManagedComponentBinTarget } from "./codex-cache-dangling-bins"
import { isNodeErrorWithCode } from "./codex-cache-fs"
import { isLegacyCodexBinTarget, LEGACY_CODEX_COMPONENT_BIN_NAMES } from "./codex-cache-legacy-bins"
import { RUNTIME_WRAPPER_MARKER } from "./codex-cache-runtime-wrapper"

type LinkPlatform = NodeJS.Platform

const ROOT_RUNTIME_BIN_NAME = "omo"

// Every bin name the installer creates: the root runtime wrapper plus each component's
// package.json `bin` key. A marker alone is not proof of ownership - a user who copies or
// renames a generated wrapper keeps the marker - so removal also requires the name to be one
// the installer itself would have written. `codex-cleanup-bins-coverage.test.ts` fails if a
// component adds a bin that is missing here, so this list cannot silently drift.
export const MANAGED_CODEX_BIN_NAMES: ReadonlySet<string> = new Set([
  ROOT_RUNTIME_BIN_NAME,
  "omo-comment-checker",
  "omo-git-bash-hook",
  "omo-lsp",
  "omo-rules",
  "omo-telemetry",
  "omo-ultrawork",
  "omo-ulw-execute-continuation",
  "omo-ulw-loop",
  "lazycodex-executor-verify",
  "ulw",
  "ulw-loop",
  ...LEGACY_CODEX_COMPONENT_BIN_NAMES,
])

// Removes the bin links the Codex installer created in binDir - the root `omo` runtime
// wrapper plus the component shims/symlinks - so uninstall no longer leaves the `omo`
// command behind (issue #6320). A candidate is removed only when BOTH its name is an
// installer bin name AND it carries the installer's own marker (or, on POSIX, resolves to a
// managed component target), so a user's own `omo`, a renamed copy of a generated wrapper,
// and an unrelated symlink all survive. Unlike the install-time dangling sweep this removes
// managed bins whether or not their cache target still exists, because uninstall also
// removes that cache.
export async function removeManagedCodexBins(binDir: string, platform: LinkPlatform): Promise<readonly string[]> {
  const entries = await readdir(binDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return null
    throw error
  })
  if (entries === null) return []

  const removed: string[] = []
  for (const entry of entries) {
    const binName = managedBinNameForEntry(entry.name, platform)
    if (binName === null || !MANAGED_CODEX_BIN_NAMES.has(binName)) continue
    const linkPath = join(binDir, entry.name)
    if (await isManagedCodexBin(linkPath, platform, binName)) {
      await rm(linkPath, { force: true })
      removed.push(linkPath)
    }
  }
  return removed
}

// Windows shims and wrappers are always written as `<name>.cmd`; anything else in the bin
// directory (including a `.backup` copy) is not something the installer created. Windows
// resolves names case-insensitively while preserving the casing an entry was created with, so
// the installer's lowercase `omo.cmd` path can write through to an entry that stays on disk as
// `OMO.CMD`; the name is lowercased here so such a wrapper is still recognized as managed.
// POSIX names stay untouched because there `OMO` really is a different file. Ownership is not
// widened by this: removal still requires the installer's marker.
function managedBinNameForEntry(entryName: string, platform: LinkPlatform): string | null {
  if (platform !== "win32") return entryName
  const normalizedEntryName = entryName.toLowerCase()
  return normalizedEntryName.endsWith(".cmd") ? normalizedEntryName.slice(0, -".cmd".length) : null
}

async function isManagedCodexBin(linkPath: string, platform: LinkPlatform, binName: string): Promise<boolean> {
  const entryStat = await lstat(linkPath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return null
    throw error
  })
  if (entryStat === null) return false

  if (entryStat.isSymbolicLink()) {
    if (platform === "win32") return false
    const linkTarget = await readlink(linkPath)
    const target = isAbsolute(linkTarget) ? linkTarget : resolve(dirname(linkPath), linkTarget)
    // The current layout is checked strictly; legacy names additionally accept the older
    // arbitrary-marketplace shape, so a legacy install does not leave commands on PATH.
    return isManagedComponentBinTarget(target) || isLegacyCodexBinTarget(binName, target)
  }

  if (!entryStat.isFile()) return false
  const content = await readFile(linkPath, "utf8")
  return content.includes(RUNTIME_WRAPPER_MARKER) || content.includes(COMMAND_SHIM_MARKER)
}
