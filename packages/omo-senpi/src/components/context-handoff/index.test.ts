import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { FakeExtensionAPI, dispatchRunEnd } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import {
  CONTEXT_HANDOFF_COMMAND,
  CONTEXT_HANDOFF_REQUEST_TYPE,
  createContextHandoffComponent,
  handoffPathFor,
  MAX_CHAINED_HANDOFFS,
  type ContextHandoffSettings,
} from "./index"
import { SEED_GENERATION_PREFIX, SEED_OPEN_TAG } from "./prompts"

const SESSION_ID = "01a10eeb-ca5e-7285-ace9-881289b59ce2"
const FINISHED_RUN = { messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] }] }
const ABORTED_RUN = { ...FINISHED_RUN, aborted: true }
const ENABLED: ContextHandoffSettings = { enabled: true, thresholdPercent: 85, repeatLimit: 3, repeatWindowMs: 600_000 }

function errorRun(errorMessage: string): Record<string, unknown> {
  return { messages: [{ role: "assistant", stopReason: "error", errorMessage, content: [] }] }
}

interface Notice {
  message: string
  level?: string
}

interface Harness {
  pi: FakeExtensionAPI
  notices: Notice[]
  errors: LoggedError[]
  setPercent(percent: number | null): void
  setCompacting(compacting: boolean): void
  advance(ms: number): void
  settle(run?: unknown): Promise<void>
  compactionFailed(payload?: Record<string, unknown>): Promise<void>
  compacted(percentAfter: number): Promise<void>
}

let root: string
let cwd: string
let sessionDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-context-handoff-"))
  cwd = join(root, "project")
  sessionDir = join(root, "sessions")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

interface LoggedError {
  message: string
  meta?: Record<string, unknown>
}

function componentContext(errors: LoggedError[] = []): ComponentContext {
  return {
    logger: {
      info: () => {},
      warn: () => {},
      error: (message: string, meta?: Record<string, unknown>) => errors.push({ message, meta }),
      debug: () => {},
    },
    config: { getFlag: () => undefined },
  }
}

const sessionFile = (): string => join(sessionDir, `2026-10-06_${SESSION_ID}.jsonl`)

function sessionManager(entries: readonly unknown[] = []): Record<string, unknown> {
  return {
    getEntries: () => entries,
    getSessionId: () => SESSION_ID,
    getSessionFile: () => sessionFile(),
    getSessionDir: () => sessionDir,
  }
}

async function createHarness(settings: ContextHandoffSettings, entries: readonly unknown[] = []): Promise<Harness> {
  const pi = new FakeExtensionAPI()
  pi.cwd = cwd
  const notices: Notice[] = []
  const errors: LoggedError[] = []
  let percent: number | null = 40
  let compacting = false
  let nowMs = 1_000_000
  const eventCtx: Record<string, unknown> = {
    cwd,
    sessionManager: sessionManager(entries),
    getContextUsage: () => ({ tokens: null, contextWindow: 1_000_000, percent }),
    isCompacting: () => compacting,
    ui: { notify: (message: string, level?: string) => notices.push({ message, level }) },
  }
  await createContextHandoffComponent({ loadSettings: () => settings, now: () => nowMs }).register(pi, componentContext(errors))
  return {
    pi,
    notices,
    errors,
    setPercent: (next) => {
      percent = next
    },
    setCompacting: (next) => {
      compacting = next
    },
    advance: (ms) => {
      nowMs += ms
    },
    settle: async (run = FINISHED_RUN) => {
      await dispatchRunEnd(pi, run, eventCtx)
    },
    compactionFailed: async (payload = { reason: "threshold", errorMessage: "summary request failed", aborted: false, willRetry: false }) => {
      await pi.dispatch("session_compact_failed", { type: "session_compact_failed", ...payload }, eventCtx)
    },
    compacted: async (percentAfter) => {
      percent = percentAfter
      await pi.dispatch("session_compact", { type: "session_compact", accepted: true, fromExtension: false, willRetry: false }, eventCtx)
    },
  }
}

function handoffRequests(pi: FakeExtensionAPI): unknown[] {
  return pi.messages.filter((call) => call.message["customType"] === CONTEXT_HANDOFF_REQUEST_TYPE)
}

function writeHandoff(content: string): string {
  const handoffPath = handoffPathFor(cwd, SESSION_ID)
  mkdirSync(join(cwd, ".omo", "handoffs"), { recursive: true })
  writeFileSync(handoffPath, content)
  return handoffPath
}

interface FreshSessionCapture {
  readonly newSessionOptions: Record<string, unknown>[]
  readonly seeds: string[]
  readonly freshNotices: Notice[]
}

const emptyCapture = (): FreshSessionCapture => ({ newSessionOptions: [], seeds: [], freshNotices: [] })

function commandContext(capture: FreshSessionCapture, entries: readonly unknown[] = []): Record<string, unknown> {
  return {
    cwd,
    sessionManager: sessionManager(entries),
    ui: { notify: () => {} },
    waitForIdle: async () => {},
    newSession: async (options: Record<string, unknown>) => {
      capture.newSessionOptions.push(options)
      const withSession = options["withSession"] as (ctx: unknown) => Promise<void>
      await withSession({
        ui: { notify: (message: string, level?: string) => capture.freshNotices.push({ message, level }) },
        sendUserMessage: async (content: string) => {
          capture.seeds.push(content)
        },
      })
      return { cancelled: false }
    },
  }
}

async function runCommand(pi: FakeExtensionAPI, args: string, commandCtx: unknown): Promise<void> {
  const command = pi.commands.find((registration) => registration.name === CONTEXT_HANDOFF_COMMAND)
  if (command === undefined) throw new Error("context handoff command not registered")
  const handler = command.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  await handler(args, commandCtx)
}

// Symlinks to directories use junctions on Windows, which need no developer mode; POSIX ignores the type.
function linkDir(target: string, path: string): void {
  symlinkSync(target, path, "junction")
}

function seedEntries(generation: number): unknown[] {
  return [
    {
      type: "message",
      message: { role: "user", content: [{ type: "text", text: `${SEED_OPEN_TAG}\n${SEED_GENERATION_PREFIX}${generation}\nhandoff body` }] },
    },
  ]
}

describe("context-handoff registration", () => {
  it("#given context_handoff is off #when the component registers #then no hook and no command are registered", async () => {
    const pi = new FakeExtensionAPI()
    pi.cwd = cwd

    await createContextHandoffComponent({ loadSettings: () => ({ ...ENABLED, enabled: false }) }).register(pi, componentContext())

    expect(pi.handlers.map((handler) => handler.event)).toEqual([])
    expect(pi.commands.map((command) => command.name)).toEqual([])
  })
})

describe("context-handoff trigger", () => {

  it("#given high usage but healthy compaction #when compaction brings usage down #then no handoff is requested", async () => {
    const harness = await createHarness(ENABLED)
    harness.setPercent(97)
    await harness.settle()

    await harness.compacted(31)
    await harness.settle()

    expect(handoffRequests(harness.pi)).toHaveLength(0)
  })

  it("#given a compaction error #when the run settles #then the handoff is requested exactly once with a warning notice", async () => {
    const harness = await createHarness(ENABLED)

    await harness.compactionFailed()
    await harness.settle()
    await harness.compactionFailed()
    await harness.settle()

    const requests = harness.pi.messages.filter((call) => call.message["customType"] === CONTEXT_HANDOFF_REQUEST_TYPE)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.message["display"]).toBe(true)
    expect(String(requests[0]?.message["content"])).toContain(handoffPathFor(cwd, SESSION_ID))
    expect(requests[0]?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" })
    expect(harness.notices.map((notice) => notice.level)).toEqual(["warning"])
  })

  it("#given a compaction the user aborted #when the run settles #then no handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    await harness.compactionFailed({ reason: "manual", aborted: true, willRetry: false })
    await harness.settle()

    expect(handoffRequests(harness.pi)).toHaveLength(0)
  })

  it("#given compaction rejections #when the cause means the context cannot shrink #then only those request a handoff", async () => {
    for (const [cause, expected] of [
      ["would-overflow", 1],
      ["circuit-breaker", 1],
      ["per-turn-cap", 1],
      ["cancelled-by-extension", 0],
      ["external-owner", 0],
      ["stale-revision", 0],
    ] as const) {
      const harness = await createHarness(ENABLED)
      await harness.pi.dispatch("session_compact", { type: "session_compact", accepted: false, rejectionCause: cause }, {
        cwd,
        sessionManager: sessionManager(),
      })
      await harness.settle()
      expect({ cause, requests: handoffRequests(harness.pi).length }).toEqual({ cause, requests: expected })
    }
  })

  it("#given a compaction that leaves usage at the limit #when the run settles #then the handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    await harness.compacted(88)
    await harness.settle()

    expect(handoffRequests(harness.pi)).toHaveLength(1)
  })

  it("#given repeated compactions inside the window #when the limit is reached #then the handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    await harness.compacted(40)
    harness.advance(60_000)
    await harness.compacted(40)
    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(0)

    harness.advance(60_000)
    await harness.compacted(40)
    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(1)
  })

  it("#given compactions spread wider than the window #when they keep succeeding #then no handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    for (let round = 0; round < 4; round += 1) {
      await harness.compacted(40)
      harness.advance(ENABLED.repeatWindowMs)
      await harness.settle()
    }

    expect(handoffRequests(harness.pi)).toHaveLength(0)
  })

  it("#given a run that ends in a context-overflow error #when it settles #then the handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    await harness.settle(errorRun("prompt is too long: 1050000 tokens > 1000000 maximum"))

    expect(handoffRequests(harness.pi)).toHaveLength(1)
  })

  it("#given a context-overflow error that senpi will retry #when the run settles #then no handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    await harness.settle({ ...errorRun("prompt is too long: 1050000 tokens > 1000000 maximum"), willRetry: true })

    expect(handoffRequests(harness.pi)).toHaveLength(0)
  })

  it("#given a compaction failure #when a later compaction brings usage under the limit #then no handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    await harness.compactionFailed()
    await harness.compacted(20)
    await harness.settle()
    await harness.settle()

    expect(handoffRequests(harness.pi)).toHaveLength(0)
    expect(harness.notices).toHaveLength(0)
  })

  it("#given a requested handoff #when a later compaction brings usage under the limit #then the handoff is cancelled", async () => {
    const harness = await createHarness(ENABLED)
    await harness.compactionFailed()
    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(1)

    await harness.compacted(20)
    for (let run = 0; run < 4; run += 1) await harness.settle()

    expect(harness.pi.userMessages).toHaveLength(0)
    expect(existsSync(handoffPathFor(cwd, SESSION_ID))).toBe(false)
  })

  it("#given a session at the chained handoff limit #when compaction fails #then it does not hand off again", async () => {
    for (const [generation, expected] of [
      [MAX_CHAINED_HANDOFFS - 1, 1],
      [MAX_CHAINED_HANDOFFS, 0],
    ] as const) {
      const harness = await createHarness(ENABLED, seedEntries(generation))
      await harness.settle()

      await harness.compactionFailed()
      await harness.settle()

      expect({ generation, requests: handoffRequests(harness.pi).length }).toEqual({ generation, requests: expected })
    }
  })

  it("#given a run that ends in an unrelated provider error #when it settles #then no handoff is requested", async () => {
    const harness = await createHarness(ENABLED)

    await harness.settle(errorRun("429 rate limit reached, retry later"))

    expect(handoffRequests(harness.pi)).toHaveLength(0)
  })

  it("#given a failure while a compaction is still running #when runs settle #then the handoff waits until compaction is idle", async () => {
    const harness = await createHarness(ENABLED)
    await harness.compactionFailed()
    harness.setCompacting(true)

    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(0)

    harness.setCompacting(false)
    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(1)
  })

  it("#given a failure and a user-aborted run #when it settles #then the handoff waits for the next finished run", async () => {
    const harness = await createHarness(ENABLED)
    await harness.compactionFailed()

    await harness.settle(ABORTED_RUN)
    expect(handoffRequests(harness.pi)).toHaveLength(0)

    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(1)
  })

  it("#given a session seeded by a handoff that never dropped below the limit #when compaction fails #then it does not hand off again", async () => {
    const seededEntries = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: `${SEED_OPEN_TAG}\nhandoff body` }] } },
    ]
    const harness = await createHarness(ENABLED, seededEntries)
    harness.setPercent(92)

    await harness.compactionFailed()
    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(0)

    harness.setPercent(30)
    await harness.settle()
    await harness.compactionFailed()
    await harness.settle()
    expect(handoffRequests(harness.pi)).toHaveLength(1)
  })
})

describe("context-handoff switch", () => {
  it("#given the handoff was requested #when the agent writes the file #then omo runs its command with command dispatch enabled", async () => {
    const harness = await createHarness(ENABLED)
    await harness.compactionFailed()
    await harness.settle()
    const handoffPath = writeHandoff("# Handoff\n- open item\n")

    await harness.settle()

    expect(harness.pi.userMessages).toEqual([
      { content: `/${CONTEXT_HANDOFF_COMMAND} ${handoffPath}`, options: { expandPromptTemplates: true } },
    ])
  })

  it("#given the handoff run itself fails #when it settles #then omo writes a fallback handoff from the session record and switches", async () => {
    const entries = [
      { type: "message", message: { role: "user", content: "Deploy kestrel-41 after the migration check" } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    ]
    const harness = await createHarness(ENABLED, entries)
    await harness.settle(errorRun("context_length_exceeded"))

    await harness.settle(errorRun("context_length_exceeded"))

    const handoffPath = handoffPathFor(cwd, SESSION_ID)
    expect(existsSync(handoffPath)).toBe(true)
    const fallback = readFileSync(handoffPath, "utf8")
    expect(fallback).toContain("Deploy kestrel-41 after the migration check")
    expect(fallback).toContain(sessionFile())
    expect(harness.pi.userMessages).toHaveLength(1)
  })

  it("#given the agent never writes the handoff #when the wait runs out #then omo writes a fallback handoff and switches once", async () => {
    const harness = await createHarness(ENABLED)
    await harness.compactionFailed()
    await harness.settle()

    for (let run = 0; run < 5; run += 1) await harness.settle()

    expect(existsSync(handoffPathFor(cwd, SESSION_ID))).toBe(true)
    expect(harness.pi.userMessages).toHaveLength(1)
    expect(handoffRequests(harness.pi)).toHaveLength(1)
  })

  it("#given a handoff was requested #when the user aborts the next run #then the pending handoff is dropped", async () => {
    const harness = await createHarness(ENABLED)
    await harness.compactionFailed()
    await harness.settle()

    await harness.settle(ABORTED_RUN)
    for (let run = 0; run < 4; run += 1) await harness.settle()

    expect(harness.pi.userMessages).toHaveLength(0)
    expect(existsSync(handoffPathFor(cwd, SESSION_ID))).toBe(false)
  })

  it("#given a handoff file older than the request #when runs settle #then it is not taken as the new handoff", async () => {
    const harness = await createHarness(ENABLED)
    const handoffPath = writeHandoff("# stale handoff from an earlier switch\n")
    utimesSync(handoffPath, 0, 0)
    await harness.compactionFailed()
    await harness.settle()

    await harness.settle()

    expect(harness.pi.userMessages).toHaveLength(0)
  })

  it("#given a session id with path separators #when the handoff path is built #then it stays inside .omo/handoffs", () => {
    for (const sessionId of ["../../outside", "..\\..\\outside", "/etc/passwd"]) {
      expect(dirname(handoffPathFor(cwd, sessionId))).toBe(join(cwd, ".omo", "handoffs"))
    }
  })

  it("#given .omo or .omo/handoffs becomes a symlink #when omo writes its fallback handoff #then the write is refused as a symlink and nothing lands outside the project", async () => {
    for (const linked of [".omo", join(".omo", "handoffs")]) {
      for (const linkedWhen of ["before the request", "after the request"] as const) {
        rmSync(join(cwd, ".omo"), { recursive: true, force: true })
        const outside = mkdtempSync(join(root, "outside-"))
        const linkPath = join(cwd, linked)
        const link = (): void => {
          rmSync(linkPath, { recursive: true, force: true })
          mkdirSync(dirname(linkPath), { recursive: true })
          linkDir(outside, linkPath)
        }
        if (linkedWhen === "before the request") link()
        const harness = await createHarness(ENABLED)

        // Same runs as the wait-runs-out test: the request, then enough settles for omo's own fallback write.
        await harness.compactionFailed()
        await harness.settle()
        if (linkedWhen === "after the request") link()
        for (let run = 0; run < 5; run += 1) await harness.settle()

        expect({
          linked,
          linkedWhen,
          requests: handoffRequests(harness.pi).length,
          outside: readdirSync(outside),
          switched: harness.pi.userMessages.length,
          refusals: harness.errors.map((logged) => logged.meta?.["error"]),
        }).toEqual({
          linked,
          linkedWhen,
          requests: linkedWhen === "after the request" ? 1 : 0,
          outside: [],
          switched: 0,
          refusals: [`${linkPath} is a symlink`],
        })
      }
    }
  })

  it("#given the handoff file is a symlink #when the wait runs out #then the link target is untouched and the handoff is a regular file", async () => {
    const secret = join(root, "secret.md")
    writeFileSync(secret, "SECRET-OUTSIDE")
    mkdirSync(join(cwd, ".omo", "handoffs"), { recursive: true })
    const handoffPath = handoffPathFor(cwd, SESSION_ID)
    symlinkSync(secret, handoffPath, "file")
    const harness = await createHarness(ENABLED)

    await harness.compactionFailed()
    for (let run = 0; run < 5; run += 1) await harness.settle()

    expect(readFileSync(secret, "utf8")).toBe("SECRET-OUTSIDE")
    expect(lstatSync(handoffPath).isSymbolicLink()).toBe(false)
    expect(readFileSync(handoffPath, "utf8")).not.toContain("SECRET-OUTSIDE")
  })

  it("#given a symlinked handoff file #when the command runs on it #then the target is not read and no fresh session starts", async () => {
    const secret = join(root, "secret.md")
    writeFileSync(secret, "SECRET-OUTSIDE")
    mkdirSync(join(cwd, ".omo", "handoffs"), { recursive: true })
    const handoffPath = handoffPathFor(cwd, SESSION_ID)
    symlinkSync(secret, handoffPath, "file")
    const harness = await createHarness(ENABLED)
    const capture = emptyCapture()

    await runCommand(harness.pi, handoffPath, commandContext(capture))

    expect(capture.newSessionOptions).toHaveLength(0)
    expect(capture.seeds).toHaveLength(0)
  })

  it("#given a path outside .omo/handoffs #when the command runs #then it is refused and no fresh session starts", async () => {
    writeFileSync(join(root, "outside.md"), "# outside\n")
    writeFileSync(join(cwd, "project-root.md"), "# project root\n")
    // A real handoff directory, so only the path confinement can refuse these reads.
    writeHandoff("# Handoff\n- item\n")
    const harness = await createHarness(ENABLED)

    for (const requested of ["../outside.md", join(root, "outside.md"), "project-root.md", ".omo/handoffs/../../project-root.md"]) {
      const capture = emptyCapture()
      await runCommand(harness.pi, requested, commandContext(capture))
      expect({ requested, started: capture.newSessionOptions.length }).toEqual({ requested, started: 0 })
    }
  })

  it("#given the command names a missing file #when it runs #then no fresh session starts", async () => {
    const harness = await createHarness(ENABLED)
    const capture = emptyCapture()

    await runCommand(harness.pi, "missing.md", commandContext(capture))

    expect(capture.newSessionOptions).toHaveLength(0)
  })
})

describe("context-handoff carry-over", () => {
  it("#given facts in the handoff and an open goal #when the failure flow completes #then the fresh session seed carries every fact, the goal, and the parent session", async () => {
    const harness = await createHarness(ENABLED)
    const facts = [
      "FACT-1 deploy target is hpdesk build 4711",
      "FACT-2 never rebase upstream PR branches",
      "FACT-3 next step: rerun verify.ps1 on commit 9c0ffee",
    ]
    mkdirSync(join(sessionDir, "extensions", "goal"), { recursive: true })
    writeFileSync(
      join(sessionDir, "extensions", "goal", `${SESSION_ID}.json`),
      JSON.stringify({ version: 1, goal: { objective: "Ship the context handoff PR", status: "active" } }),
    )
    await harness.compacted(91)
    await harness.settle()
    const handoffPath = writeHandoff(`# Handoff\n${facts.map((fact) => `- ${fact}`).join("\n")}\n`)
    await harness.settle()
    const dispatched = harness.pi.userMessages[0]?.content
    if (typeof dispatched !== "string") throw new Error("handoff command was not dispatched")
    const capture = emptyCapture()

    await runCommand(harness.pi, dispatched.slice(`/${CONTEXT_HANDOFF_COMMAND} `.length), commandContext(capture))

    expect(capture.newSessionOptions).toHaveLength(1)
    expect(capture.newSessionOptions[0]?.["parentSession"]).toBe(sessionFile())
    expect(capture.seeds).toHaveLength(1)
    const seed = capture.seeds[0] ?? ""
    for (const fact of facts) expect(seed).toContain(fact)
    expect(seed).toContain("Ship the context handoff PR")
    expect(seed).toContain(sessionFile())
    expect(capture.freshNotices[0]?.message).toContain(handoffPath)
  })

  it("#given a completed goal #when the fresh session is seeded #then the goal is not carried over", async () => {
    const harness = await createHarness(ENABLED)
    mkdirSync(join(sessionDir, "extensions", "goal"), { recursive: true })
    writeFileSync(
      join(sessionDir, "extensions", "goal", `${SESSION_ID}.json`),
      JSON.stringify({ version: 1, goal: { objective: "Old finished goal", status: "complete" } }),
    )
    writeHandoff("# Handoff\n- item\n")
    const capture = emptyCapture()

    await runCommand(harness.pi, join(".omo", "handoffs", `${SESSION_ID}.md`), commandContext(capture))

    expect(capture.seeds[0]).toContain("- item")
    expect(capture.seeds[0]).not.toContain("Old finished goal")
  })

  it("#given a session seeded by a handoff #when it hands off again #then the fresh seed counts one more chained handoff", async () => {
    const harness = await createHarness(ENABLED)
    writeHandoff("# Handoff\n- item\n")
    const capture = emptyCapture()

    await runCommand(harness.pi, "", commandContext(capture, seedEntries(2)))

    expect(capture.seeds[0]?.split("\n")[1]).toBe(`${SEED_GENERATION_PREFIX}3`)
  })
})
