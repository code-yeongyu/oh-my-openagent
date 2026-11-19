import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteProgram, SshExit } from "./ssh-port"

export type DoritermFailureCode = "install_failed" | "invite_failed" | "join_failed" | "verify_failed"

export type DoritermOutcome =
  | { readonly kind: "skipped"; readonly reason: "caller_has_no_mesh" }
  | { readonly kind: "skipped"; readonly reason: "target_prerequisite_missing"; readonly missing: "git" | "bun" }
  | { readonly kind: "attached"; readonly members: number }
  | { readonly kind: "failed"; readonly code: DoritermFailureCode; readonly message: string }

// Fixed per code: doriterm's own output is never passed on, since its join and invite lines may name a link file.
const FAILURE_MESSAGES: Readonly<Record<DoritermFailureCode, string>> = {
  install_failed: "doriterm could not be installed on the new machine",
  invite_failed: "this device could not make a doriterm join link",
  join_failed: "the new machine could not join the doriterm mesh",
  verify_failed: "the doriterm mesh did not list the new machine",
}

/** doriterm's setup command line on the calling device; resolves its exit and stdout lines. */
export type DoritermLocal = (
  args: readonly string[],
) => Promise<{ readonly code: number | null; readonly lines: readonly string[] }>

export type DoritermPorts = {
  readonly local: DoritermLocal
  /** One remote program on the new machine, with an optional stdin payload. */
  readonly remote: (
    program: RemoteProgram,
    stdin?: string,
  ) => Promise<{ readonly lines: readonly string[]; readonly exit: SshExit }>
  /** A fresh owner-only directory the invite file is written to; removed on every exit path. */
  readonly tempDir?: () => Promise<string>
  readonly sleep: (ms: number) => Promise<void>
}

// doriterm's setup skill: a new member's line comes up about 20 seconds after the join, so verify is retried for up to
// a minute before the attach counts as failed.
const VERIFY_ATTEMPTS = 6
const VERIFY_INTERVAL_MS = 10_000

const MIN_BUN: readonly [number, number, number] = [1, 4, 4]
const bunRecentEnough = (version: string): boolean => {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (parts === null) return false
  const have = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  for (let index = 0; index < 3; index++) {
    const a = have[index] ?? 0
    const b = MIN_BUN[index] ?? 0
    if (a !== b) return a > b
  }
  return true
}

// "doriterm-setup: mesh ok mesh 1a2b3c4d sync=... 3 members: a=self b=connected c=connected"
const membersOf = (lines: readonly string[]): number | undefined => {
  for (const line of lines) {
    const match = /^doriterm-setup: mesh \w+ mesh [0-9a-f]+ \S+ (\d+) members:/.exec(line)
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return undefined
}
const resultOk = (lines: readonly string[]): boolean => lines.includes("doriterm-setup: result ok")

const failed = (code: DoritermFailureCode): DoritermOutcome => ({
  kind: "failed",
  code,
  message: FAILURE_MESSAGES[code],
})

const ownerOnlyTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "omo-doriterm-invite-"))
  await chmod(dir, 0o700)
  return dir
}

/**
 * Joins the new machine to the calling device's doriterm mesh with doriterm's own setup verbs. The ten-minute
 * single-use link is made only after the target is installed and verified, crosses the connection on stdin, and is
 * never returned, logged or put in an error.
 */
export async function attachDoriterm(ports: DoritermPorts): Promise<DoritermOutcome> {
  let stage: DoritermFailureCode = "install_failed"
  try {
    return await attach(ports, (next) => {
      stage = next
    })
  } catch {
    return failed(stage)
  }
}

async function attach(ports: DoritermPorts, enter: (stage: DoritermFailureCode) => void): Promise<DoritermOutcome> {
  const before = await ports.local(["verify"])
  const members = membersOf(before.lines)
  if (members === undefined) return { kind: "skipped", reason: "caller_has_no_mesh" }

  const prerequisites = await ports.remote({ kind: "doriterm_prerequisites" })
  if (!prerequisites.lines.includes("git:present"))
    return { kind: "skipped", reason: "target_prerequisite_missing", missing: "git" }
  const bun = prerequisites.lines.find((line) => /^\d+\.\d+\.\d+/.test(line))
  if (bun === undefined || !bunRecentEnough(bun))
    return { kind: "skipped", reason: "target_prerequisite_missing", missing: "bun" }

  const installed = await ports.remote({ kind: "doriterm_install" })
  if (installed.exit.code !== 0) return failed("install_failed")

  enter("invite_failed")
  const dir = await (ports.tempDir ?? ownerOnlyTempDir)()
  try {
    const file = join(dir, "invite")
    const invite = await ports.local(["invite", "--out", file])
    if (invite.code !== 0 || !resultOk(invite.lines)) return failed("invite_failed")
    const link = (await readFile(file, "utf8").catch(() => "")).trim()
    if (link === "") return failed("invite_failed")
    enter("join_failed")
    const joined = await ports.remote({ kind: "doriterm_join" }, link)
    if (joined.exit.code !== 0 || !resultOk(joined.lines)) return failed("join_failed")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  enter("verify_failed")
  for (let attempt = 1; ; attempt++) {
    const after = await ports.local(["verify", "--min-members", String(members + 1)])
    const now = membersOf(after.lines)
    if (after.code === 0 && now !== undefined && now >= members + 1) return { kind: "attached", members: now }
    if (attempt >= VERIFY_ATTEMPTS) return failed("verify_failed")
    await ports.sleep(VERIFY_INTERVAL_MS)
  }
}
