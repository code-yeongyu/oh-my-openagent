import { describe, expect, test } from "bun:test"

import { execFileSync, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { GitAbortedError } from "./errors"
import { createNodeGitExec, type GitExec } from "./exec"
import { GitMemoryRepo } from "./repo"
import { settlesWithin } from "./settles-within.test-support"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"

/** 16 packs of incompressible blobs, with a delta window wide enough that their fold runs for many seconds. */
function repoDueForASlowFold(dir: string): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" })
  git("init", "-q")
  disableFixtureAutoMaintenance(dir)
  for (let pack = 0; pack < 16; pack++) {
    for (let blob = 0; blob < 100; blob++) writeFileSync(join(dir, `blob-${blob}`), randomBytes(8192))
    git("add", "-A")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", "commit", "-qm", `pack ${pack}`)
    git("repack", "-q")
  }
  git("config", "pack.window", "250")
  git("config", "pack.threads", "1")
}

describe("runMemoryRepoMaintenance abort (#15429 L1)", () => {
  test.skipIf(process.platform === "win32")(
    "#given a fold whose pack-objects child is running #when the pass is aborted #then the pack-objects child exits too",
    async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), "memory-fold-abort-"))
      const fifo = join(dir, "repack-trace.fifo")
      try {
        repoDueForASlowFold(dir)
        execFileSync("mkfifo", [fifo])
        // Every traced git process holds the FIFO open for writing until it exits, so the reader sees
        // end-of-file (and exits) only once repack and every git it started are gone.
        const reader = spawn("cat", [fifo], { stdio: ["ignore", "pipe", "ignore"] })
        const readerExited = new Promise<void>((resolve) => reader.once("exit", () => resolve()))
        const packObjectsPids: number[] = []
        const packObjectsStarted = new Promise<void>((resolve) => {
          let pending = ""
          reader.stdout.on("data", (chunk: Buffer) => {
            pending += chunk.toString("utf8")
            const lines = pending.split("\n")
            pending = lines.pop() ?? ""
            for (const line of lines) {
              const event = JSON.parse(line) as { event?: string; sid?: string; argv?: string[] }
              if (event.event !== "start" || event.argv?.[1] !== "pack-objects") continue
              packObjectsPids.push(Number.parseInt(/-P([0-9a-f]+)$/.exec(event.sid ?? "")?.[1] ?? "", 16))
              resolve()
            }
          })
        })
        const real = createNodeGitExec()
        const tracedRepack: GitExec = {
          run: (argv, options) =>
            real.run(argv, argv.includes("repack") ? { ...options, env: { ...options.env, GIT_TRACE2_EVENT: fifo } } : options),
        }
        const repo = new GitMemoryRepo({ dir, agentId: "fold-abort", exec: tracedRepack })
        const controller = new AbortController()
        const pass = repo.maintain({ minLooseObjects: 2_000, timeoutMs: 120_000, signal: controller.signal })
        const passSettled = pass.then(
          () => undefined,
          (error: unknown) => error,
        )
        try {
          expect(await settlesWithin(packObjectsStarted, 60_000)).toEqual({ kind: "settled", value: undefined })

          // when
          controller.abort()

          // then
          expect(await passSettled).toBeInstanceOf(GitAbortedError)
          expect(await settlesWithin(readerExited, 10_000)).toEqual({ kind: "settled", value: undefined })
        } finally {
          for (const pid of packObjectsPids) {
            try {
              process.kill(pid, "SIGKILL")
            } catch {
              // Already gone: the expected outcome.
            }
          }
          reader.kill()
          await readerExited
          await passSettled
        }
      } finally {
        await removeTree(dir)
      }
    },
    120_000,
  )
})
