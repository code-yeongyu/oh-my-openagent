// The trust stage refuses a trust directory with a group- or world-writable non-sticky ancestor (#13503), and the
// trust tests root their directories under tmpdir(). A caller's TMPDIR created under umask 002 is such an ancestor,
// so the suites failed only on hosts whose test runner hands them one (omo#13697). Each trust suite runs with a
// private TMPDIR under the first base the stage itself judges safe.
import { afterAll, beforeAll } from "bun:test"
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { judgeAncestor } from "../trust-generation"
import { readUsernsView } from "../trust-userns"

function judgedSafe(path: string): boolean {
  const view = process.platform === "linux" ? readUsernsView(process.env) : null
  for (let current = path; ; current = dirname(current)) {
    const stat = lstatSync(current, { bigint: true })
    const verdict = judgeAncestor(
      view,
      current,
      {
        directory: stat.isDirectory(),
        symlink: stat.isSymbolicLink(),
        mode: Number(stat.mode),
        uid: Number(stat.uid),
        dev: stat.dev,
        ino: stat.ino,
      },
      process.getuid?.(),
      process.platform,
    )
    if (verdict !== "ok") return false
    if (dirname(current) === current) return true
  }
}

function safeBase(): string {
  const candidates = process.platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp"]
  const bases = candidates.map((candidate) => realpathSync(candidate))
  const base = bases.find(judgedSafe)
  if (base === undefined) {
    throw new Error(
      `no temporary base the trust stage accepts: ${bases.join(", ")} each sit under a group- or world-writable ` +
        "directory without the sticky bit; set TMPDIR to a private directory",
    )
  }
  return base
}

/** Gives the calling test file a private TMPDIR for its lifetime; register it before any hook that reads tmpdir(). */
export function usePrivateTmpdir(): void {
  const inherited = process.env.TMPDIR
  let directory = ""
  beforeAll(() => {
    directory = realpathSync(mkdtempSync(join(safeBase(), "omo-trust-test-")))
    process.env.TMPDIR = directory
  })
  afterAll(() => {
    if (inherited === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = inherited
    if (directory) rmSync(directory, { recursive: true, force: true })
  })
}
