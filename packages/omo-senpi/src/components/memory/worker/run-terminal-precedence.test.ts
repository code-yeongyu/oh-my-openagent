import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkRunAbandonmentPrecedence } from "./run-terminal-precedence"
import { writeRunJsonAtomic } from "./run-artifacts"
import { claimRunTerminal, readRunTerminalClaim } from "./run-terminal-claim"
import type { ReservationRunLedger } from "./reservation-run-ledger"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "run-terminal-precedence-"))
  roots.push(root)
  const runDir = join(root, "runs", "run-1")
  await mkdir(runDir, { recursive: true })
  const ledger: ReservationRunLedger = {
    version: 1,
    runId: "run-1",
    attempt: 1,
    category: "quick",
    conversationIds: ["conversation-a"],
    kind: "reflection",
    trigger: "step-count",
    startedAt: "2026-08-11T10:00:00.000Z",
    hardDeadlineAt: 1,
    terminationGraceMs: 1,
    deadlineAt: 2,
    mergePolicy: "auto",
    worktreeDir: join(root, "missing-worktree"),
    worktreeBranch: "memory/reflection-missing",
    baseSha: "0000000000000000000000000000000000000000",
    gitFilePath: join(root, "missing-worktree", ".git"),
    gitFileSnapshot: "gitdir: missing\n",
    commonConfigPath: join(root, "config"),
    commonConfigSnapshot: null,
    pid: 424242,
    processStart: null,
  }
  await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger)
  return { runDir }
}

describe("run abandonment precedence", () => {
  test("#given a publisher that finishes during liveness classification #when precedence is checked #then abandonment is vetoed", async () => {
    // given
    const { runDir } = await fixture()

    // when
    const precedence = await checkRunAbandonmentPrecedence(runDir, "run-1", {
      getPidLiveness: () => {
        writeFileSync(join(runDir, "publishing.json"), JSON.stringify({
          version: 1,
          runId: "run-1",
          attempt: 1,
          finishedAt: "2026-08-11T10:01:00.000Z",
        }))
        return "unknown"
      },
    })

    // then
    expect(precedence.decision).toBe("veto")
  }, 30_000)

  test("#given a publish claimant whose pid is confirmed dead #when precedence is checked #then abandonment reclaims the terminal claim", async () => {
    // given
    const { runDir } = await fixture()
    await claimRunTerminal(runDir, { runId: "run-1", attempt: 1 }, "publish", {}, 434343)

    // when
    const precedence = await checkRunAbandonmentPrecedence(runDir, "run-1", {
      getPidLiveness: (pid) => pid === 434343 ? "dead" : "unknown",
    })

    // then
    expect(precedence.decision).toBe("abandon")
    expect(readRunTerminalClaim(runDir)).toMatchObject({
      kind: "abandon",
      runId: "run-1",
      attempt: 1,
    })
  }, 30_000)

  test("#given a publish claimant whose pid liveness is unknown #when precedence is checked #then the run stays active", async () => {
    // given
    const { runDir } = await fixture()
    await claimRunTerminal(runDir, { runId: "run-1", attempt: 1 }, "publish", {}, 434343)

    // when
    const precedence = await checkRunAbandonmentPrecedence(runDir, "run-1", {
      getPidLiveness: () => "unknown",
    })

    // then
    expect(precedence.decision).toBe("veto")
    expect(readRunTerminalClaim(runDir).kind).toBe("publish")
  }, 30_000)

  test("#given a genuinely dead run with unknown liveness #when precedence is checked #then it still abandons", async () => {
    // given
    const { runDir } = await fixture()

    // when
    const precedence = await checkRunAbandonmentPrecedence(runDir, "run-1", { getPidLiveness: () => "unknown" })

    // then
    expect(precedence.decision).toBe("abandon")
  }, 30_000)
})
