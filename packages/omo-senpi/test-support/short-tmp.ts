import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, parse } from "node:path"

/**
 * A short temp root for tests that create unix sockets or model a darwin socket path: darwin caps a socket path near
 * 104 bytes, so POSIX keeps `/tmp`. win32 has no `/tmp`, and its OS temp dir is a long per-user path that pushes a
 * modelled shard socket past that cap, so it uses the temp dir's drive root (`C:\`). Tests remove what they create.
 */
const SHORT_TMP_ROOT = process.platform === "win32" ? parse(tmpdir()).root : "/tmp"

// Every directory shortTempDir created, with the test file that asked for it. These paths live OUTSIDE the OS
// temp dir the run-level teardown scans (#9766), so a forgotten cleanup would leak with no signal; the shared
// teardown reads the registry and fails the run naming the owner instead (#15106).
const made = new Map<string, string>()

const callerFile = (): string => {
  for (const line of new Error().stack?.split("\n") ?? []) {
    const file = /\(?((?:\/|\\)[^\s()]+):\d+:\d+\)?/u.exec(line)?.[1]
    if (file !== undefined && !file.endsWith("short-tmp.ts")) return file
  }
  return "unknown caller"
}

/** mkdtempSync under SHORT_TMP_ROOT, registered so the shared teardown can verify its removal. */
export function shortTempDir(prefix: string): string {
  const path = mkdtempSync(join(SHORT_TMP_ROOT, prefix))
  made.set(path, callerFile())
  return path
}

/** A directory the creating test has not removed yet, with the test file that created it. */
export type ShortTempLeftover = { readonly path: string; readonly file: string }

/** The registered directories that still existed, each removed here and reported with its owner. */
export function unsettledShortTempDirs(): readonly ShortTempLeftover[] {
  const leftovers: ShortTempLeftover[] = []
  for (const [path, file] of made) {
    if (!existsSync(path)) {
      made.delete(path)
      continue
    }
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // A held directory stays registered: the next teardown reports it again.
    }
    leftovers.push({ path, file })
    if (!existsSync(path)) made.delete(path)
  }
  return leftovers
}
