import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, type Stats } from "node:fs"
import { homedir, userInfo } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

import { resolveHomeDir } from "@oh-my-opencode/omo-config-core"

import { log } from "./logger"

const LEGACY_WORKSPACE_DIR = ".sisyphus"
const WORKSPACE_DIR = ".omo"

export type LegacyWorkspaceMigrationResult = {
  migrated: boolean
  skipped: string[]
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function copyMissingEntries(legacyPath: string, targetPath: string, targetRoot: string, skipped: string[]): boolean {
  const legacyStat = lstatSync(legacyPath)

  if (legacyStat.isSymbolicLink()) {
    skipped.push(join(WORKSPACE_DIR, relative(targetRoot, targetPath)))
    return false
  }

  // lstat, not existsSync: a dangling link at the target reads as missing to existsSync, and copying
  // onto it would write through the link to wherever it points.
  const targetStat = lstatOrNull(targetPath)
  if (targetStat !== null) {
    if (legacyStat.isDirectory() && targetStat.isDirectory()) {
      let copiedChild = false
      for (const entry of readdirSync(legacyPath)) {
        copiedChild = copyMissingEntries(join(legacyPath, entry), join(targetPath, entry), targetRoot, skipped) || copiedChild
      }
      return copiedChild
    }

    skipped.push(join(WORKSPACE_DIR, relative(targetRoot, targetPath)))
    return false
  }

  if (legacyStat.isDirectory()) {
    mkdirSync(targetPath, { recursive: true })
    let copiedChild = false
    for (const entry of readdirSync(legacyPath)) {
      copiedChild = copyMissingEntries(join(legacyPath, entry), join(targetPath, entry), targetRoot, skipped) || copiedChild
    }
    return copiedChild
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(legacyPath, targetPath, constants.COPYFILE_EXCL)
  return true
}

export function migrateLegacyWorkspaceDirectory(directory: string): LegacyWorkspaceMigrationResult {
  const legacyDirectory = join(directory, LEGACY_WORKSPACE_DIR)
  if (!existsSync(legacyDirectory)) {
    return { migrated: false, skipped: [] }
  }

  // In $HOME, `.omo` is the OmO home (agent dir, memory, the desktop app's live data under
  // ~/.omo/desktop), not a project workspace, so the per-project migration never writes into it.
  // The only home-level legacy entry, ~/.sisyphus/rules, is still read in place by the rules engine.
  // Every spelling of "home": HOME/USERPROFILE (the config loader's user layer), os.homedir(), and the
  // account home the config loader also treats as a boundary. Any of them can be the OmO home.
  const homes = new Set([resolveHomeDir(), homedir(), userInfo().homedir].map(canonicalPath))
  if (homes.has(canonicalPath(directory))) {
    return { migrated: false, skipped: [] }
  }

  const targetDirectory = join(directory, WORKSPACE_DIR)
  const skipped: string[] = []

  try {
    const migrated = copyMissingEntries(legacyDirectory, targetDirectory, targetDirectory, skipped)
    if (migrated || skipped.length > 0) {
      log("[legacy-workspace-migration] Checked legacy workspace directory", {
        legacyDirectory,
        targetDirectory,
        migrated,
        skipped,
      })
    }
    return { migrated, skipped }
  } catch (error) {
    log("[legacy-workspace-migration] Failed to migrate legacy workspace directory", {
      legacyDirectory,
      targetDirectory,
      error,
    })
    return { migrated: false, skipped }
  }
}
