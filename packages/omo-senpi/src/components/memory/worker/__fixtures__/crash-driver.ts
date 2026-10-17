// Crash-recovery driver: every path that can reach a kill point runs here, in a child the e2e test
// starts with an explicit environment, never in the test process.
//
//   --root <dir> --run [--dream] [--child commit|noop|commit-fail|commit-hang|commit-late-ok] [--deadline-ms <n>] [--kill-self-after-supervisor-exit]
//   --root <dir> --reconcile [--fail-receipt <event>] [--now-offset-ms <n>]

import { join } from "node:path"

import {
  appendMemoryReceiptOnce,
  buildIdentityPaths,
  ReflectionReservationStore,
  TranscriptJournal,
  type MemoryIdentity,
  type MemoryReceiptInput,
} from "@oh-my-opencode/memory-core"

import type { MemoryReceiptsPort } from "../../receipts-port"
import { resolveAndPreflightMemoryLaunch, type ResolveAndPreflightMemoryLaunch } from "../memory-launch-preflight"
import { reconcileReflectionRuns } from "../run-reconciliation"
import { createRunnerHarness } from "../runner.test-support"

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const root = value("--root")
if (root === undefined) throw new Error("--root is required")
const report = (line: string) => { process.stdout.write(`${line}\n`) }
const childMode = (mode: string | undefined) => {
  if (mode === undefined) return "commit" as const
  if (mode === "noop" || mode === "commit-fail" || mode === "commit-hang" || mode === "commit-late-ok") return mode
  throw new Error(`unknown --child mode ${mode}`)
}

if (flag("--run")) {
  const killSelf = flag("--kill-self-after-supervisor-exit")
  const observed: ResolveAndPreflightMemoryLaunch = (input) => resolveAndPreflightMemoryLaunch({
    ...input,
    attempt: async (candidate, attemptNumber, nextAttempt) => {
      try {
        return await input.attempt(candidate, attemptNumber, nextAttempt)
      } catch (error) {
        report(`supervisor-exit: ${error instanceof Error ? error.message : String(error)}`)
        if (killSelf) process.kill(process.pid, process.platform === "win32" ? undefined : "SIGKILL")
        throw error
      }
    },
  })
  const harness = await createRunnerHarness({
    root,
    dream: flag("--dream"),
    childMode: childMode(value("--child")),
    ...(value("--deadline-ms") === undefined ? {} : { deadlineMs: Number(value("--deadline-ms")) }),
    resolveAndPreflightLaunch: observed,
  })
  report(`reserved: ${harness.run.runId}`)
  const result = await harness.runner.launch(harness.run)
  report(`launched: ${JSON.stringify({ runId: result.runId, outcome: result.outcome })}`)
} else if (flag("--reconcile")) {
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const store = new ReflectionReservationStore({
    identity,
    config: { stepCount: 1, onCompaction: true },
    getJournal: async (conversationId) => new TranscriptJournal({ journalDir: join(identity.paths.transcripts, conversationId) }),
    createRunId: () => { throw new Error("reconciliation mints no run id") },
  })
  const failing = value("--fail-receipt")
  const receipts: MemoryReceiptsPort = {
    append: async (runtimeDir: string, input: MemoryReceiptInput) => {
      if (input.event === failing) throw new Error(`injected receipt loss for ${failing}`)
      return appendMemoryReceiptOnce(runtimeDir, input)
    },
  }
  const offset = Number(value("--now-offset-ms") ?? "0")
  const results = await reconcileReflectionRuns({
    identity,
    reservation: store,
    now: () => Date.now() + offset,
    receipts,
    warn: (message, fields) => report(`receipt-warning: ${message} ${JSON.stringify(fields)}`),
  })
  report(`reconciled: ${JSON.stringify(results)}`)
} else {
  throw new Error(`unknown crash-driver mode in ${join(...args)}`)
}
