import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOnboardingComponent, type OnboardingComponentDependencies } from "./component"
import { nodeSessionHistoryFs, type SessionHistoryFile, type SessionHistoryFileStats, type SessionHistoryFs } from "./session-history"
import * as state from "./state"
import { createOnboardingHarness } from "./test-harness"

// Contract (#10505 review HIGH): the TUI onboarding's first prompt never waits on the session-history
// scan. The scan runs in the background, bounded, and its summary reaches the context afterwards;
// a slow, hanging or failing scan leaves the prompt intact.

const SESSIONS_PER_SOURCE = 3000
const PROJECTS = 20
const FIRST_PROMPT_BUDGET_MS = 500
const WAIT_MS = 20_000

let root = ""
let home = ""
const dirs: string[] = []

function newestPrompt(source: "claude" | "codex", index: number): string {
  return `${source} request number ${index}`
}

beforeAll(() => {
  // A large synthetic Claude Code + Codex history: thousands of recent transcripts across real
  // project directories, so a scan that reads all of them is measurably slow on any machine.
  root = realpathSync(mkdtempSync(join(tmpdir(), "omo-onboarding-history-")))
  home = join(root, "home")
  const projects = Array.from({ length: PROJECTS }, (_, index) => {
    const project = join(root, "work", `project-${index}`)
    mkdirSync(project, { recursive: true })
    return project
  })
  const now = Date.now()
  for (let index = 0; index < SESSIONS_PER_SOURCE; index++) {
    const cwd = projects[index % PROJECTS] ?? root
    const atMs = now - index * 60_000
    const at = new Date(atMs).toISOString()
    const claudeDir = join(home, ".claude", "projects", `-work-project-${index % PROJECTS}`)
    mkdirSync(claudeDir, { recursive: true })
    const claudeFile = join(claudeDir, `claude-${index}.jsonl`)
    writeFileSync(claudeFile, [
      JSON.stringify({ type: "user", cwd, sessionId: `claude-${index}`, timestamp: at, message: { role: "user", content: newestPrompt("claude", index) } }),
      JSON.stringify({ type: "assistant", sessionId: `claude-${index}`, timestamp: at, message: { role: "assistant", content: [{ type: "text", text: "Done" }] } }),
    ].join("\n"))
    utimesSync(claudeFile, atMs / 1000, atMs / 1000)
    const codexDir = join(home, ".codex", "sessions", "2026", "10", "19")
    mkdirSync(codexDir, { recursive: true })
    const codexFile = join(codexDir, `rollout-${index}.jsonl`)
    writeFileSync(codexFile, [
      JSON.stringify({ type: "session_meta", payload: { id: `codex-${index}`, cwd } }),
      JSON.stringify({ type: "event_msg", timestamp: at, payload: { type: "user_message", message: newestPrompt("codex", index) } }),
      JSON.stringify({ type: "response_item", timestamp: at, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } }),
    ].join("\n"))
    utimesSync(codexFile, atMs / 1000, atMs / 1000)
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("omo.onboard"))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function harness(overrides: Partial<OnboardingComponentDependencies> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-history-state-"))
  dirs.push(dir)
  const component = createOnboardingComponent({
    claimOnboarding: () => state.claimOnboarding(dir),
    isOnboardingComplete: () => state.isOnboardingComplete(dir),
    releaseOnboarding: () => state.releaseOnboarding(dir),
    scanEnvironment: () => ({ home, env: { HOME: home }, agentDir: join(home, ".omo", "agent") }),
    ...overrides,
  })
  return createOnboardingHarness(dir, "history", "tui", component)
}

function nextSentMessage(h: ReturnType<typeof harness>): Promise<{ message: Record<string, unknown>; options?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`waited ${WAIT_MS}ms for the background history message, never sent`)), WAIT_MS)
    const send = h.pi.sendMessage.bind(h.pi)
    h.pi.sendMessage = (message, options) => {
      send(message, options)
      clearTimeout(timer)
      resolve({ message, ...(options === undefined ? {} : { options }) })
    }
  })
}

async function timedPrompt(h: ReturnType<typeof harness>): Promise<{ ms: number; content: string }> {
  const startedAt = performance.now()
  const results = await h.prompt()
  const ms = performance.now() - startedAt
  const contents = results.flatMap((result) =>
    typeof result === "object" && result !== null && "message" in result
      ? [String((result as { message: { content: unknown } }).message.content)]
      : [])
  expect(contents).toHaveLength(1)
  return { ms, content: contents[0] ?? "" }
}

describe("onboarding session history in the background", () => {
  beforeAll(async () => {
    // Module compilation is not what this file measures: load the scan runtime once up front.
    await import("./scan-runtime")
  })

  test("#given a large Claude Code and Codex history #when the first prompt claims onboarding #then its context is ready within 500 ms", async () => {
    const h = harness()
    await h.start()

    const { ms, content } = await timedPrompt(h)

    expect(content).toContain("onboarding/SKILL.md")
    expect(ms).toBeLessThan(FIRST_PROMPT_BUDGET_MS)
  }, WAIT_MS)

  test("#given a large history #when the first prompt has returned #then the bounded history summary arrives afterwards for the next turn", async () => {
    const h = harness()
    await h.start()
    const arrived = nextSentMessage(h)

    const { ms, content } = await timedPrompt(h)
    expect(ms).toBeLessThan(FIRST_PROMPT_BUDGET_MS)
    expect(content).not.toContain(newestPrompt("claude", 0))

    const { message, options } = await arrived
    expect(message["customType"]).toBe("omo-onboarding:history")
    expect(message["display"]).toBe(false)
    expect(options).toEqual({ deliverAs: "nextTurn" })
    const history = String(message["content"])
    expect(history).toContain(newestPrompt("claude", 0))
    expect(history).toContain(newestPrompt("codex", 0))
    expect(history).not.toContain(newestPrompt("claude", SESSIONS_PER_SOURCE - 1))
    expect(history).not.toContain(newestPrompt("codex", SESSIONS_PER_SOURCE - 1))
  }, WAIT_MS)

  test("#given a history scan that never settles #when the first prompt claims onboarding #then the prompt carries its context and nothing waits", async () => {
    let scans = 0
    const h = harness({
      migrationFacts: () => Promise.resolve(undefined),
      sessionHistory: () => {
        scans++
        return new Promise<string | undefined>(() => {})
      },
    })
    await h.start()

    const { ms, content } = await timedPrompt(h)

    expect(content).toContain("onboarding/SKILL.md")
    expect(ms).toBeLessThan(FIRST_PROMPT_BUDGET_MS)
    expect(scans).toBe(1)
    expect(h.pi.messages).toEqual([])
  })

  test("#given a history scan that fails #when the first prompt claims onboarding #then the prompt is intact and no history is sent", async () => {
    let failure: Promise<string | undefined> | undefined
    const h = harness({
      migrationFacts: () => Promise.resolve(undefined),
      sessionHistory: () => (failure = Promise.reject(new Error("history unavailable"))),
    })
    await h.start()

    const { content } = await timedPrompt(h)
    expect(content).toContain("onboarding/SKILL.md")
    await failure?.catch(() => undefined)
    await new Promise((resolve) => setImmediate(resolve))

    expect(h.pi.messages).toEqual([])
    expect(state.isOnboardingComplete(dirs[0] ?? "")).toBe(true)
  })

  test("#given session discovery that never answers #when the background summary runs #then its time budget ends it with no history", async () => {
    const { onboardingHistorySummary } = await import("./scan-runtime")
    const hanging = (): Promise<never> => new Promise(() => {})
    const fs = { readDirectory: hanging, stat: hanging, realPath: hanging, readFileString: hanging, open: hanging }

    const summary = await onboardingHistorySummary({ home, env: { HOME: home }, sessionHistory: { fs, omoSessionsRoots: [] } }, 50)

    expect(summary).toBeUndefined()
  })

  test("#given 3000 Claude Code and 3000 Codex transcripts #when the background summary runs #then it opens at most the newest 12 transcripts", async () => {
    // Bound: listing and stat-ing directory entries is the cheap ordering step and may touch every file;
    // opening a transcript (a read) is the expensive step and may happen for at most the 12 sessions summarized.
    const { onboardingHistorySummary, ONBOARDING_HISTORY_MAX_SESSIONS } = await import("./scan-runtime")
    const calls = { readDirectory: 0, stat: 0, realPath: 0, readFileString: 0, open: 0 }
    const opened = new Set<string>()
    const fs: SessionHistoryFs = {
      readDirectory: (path) => (calls.readDirectory++, nodeSessionHistoryFs.readDirectory(path)),
      stat: (path) => (calls.stat++, nodeSessionHistoryFs.stat(path)),
      realPath: (path) => (calls.realPath++, nodeSessionHistoryFs.realPath(path)),
      readFileString: (path) => (calls.readFileString++, nodeSessionHistoryFs.readFileString(path)),
      open: (path) => {
        calls.open++
        opened.add(path)
        return nodeSessionHistoryFs.open(path)
      },
    }

    const summary = await onboardingHistorySummary({ home, env: { HOME: home }, sessionHistory: { fs, omoSessionsRoots: [] } }, WAIT_MS)

    expect(calls.open).toBeLessThanOrEqual(ONBOARDING_HISTORY_MAX_SESSIONS)
    expect(opened.size).toBeLessThanOrEqual(ONBOARDING_HISTORY_MAX_SESSIONS)
    expect(calls.readFileString).toBe(0)
    expect(summary).toContain(`newest ${ONBOARDING_HISTORY_MAX_SESSIONS},`)
    expect(summary).toContain(newestPrompt("claude", 0))
    expect(summary).toContain(newestPrompt("codex", 0))
    expect(summary).not.toContain(newestPrompt("claude", ONBOARDING_HISTORY_MAX_SESSIONS))
  }, WAIT_MS)

  test("#given a filesystem that answers slowly #when the time budget fires #then no filesystem call is made afterwards and the summary resolves", async () => {
    const { onboardingHistorySummary } = await import("./scan-runtime")
    const gated = createGatedFs("/fake-home")

    // The 50 ms budget is the behavior under test; every fs call stays pending until released.
    const summary = await onboardingHistorySummary(
      { home: "/fake-home", env: { HOME: "/fake-home" }, sessionHistory: { fs: gated.fs, omoSessionsRoots: [] } },
      50,
    )
    const callsAtDeadline = gated.calls.length
    expect(callsAtDeadline).toBeGreaterThan(0)

    // Release everything that was pending at the deadline; an abandoned walk would now issue its next call.
    await gated.releaseAll()

    expect(summary).toBeUndefined()
    expect(gated.calls.slice(callsAtDeadline)).toEqual([])
  })
})

/**
 * An in-memory agent home whose every call waits for an explicit release, so the test decides when
 * the filesystem answers. `releaseAll` settles each pending call, then lets queued microtasks and one
 * macrotask turn run, which is enough for any continuation to issue its next call.
 */
function createGatedFs(homeDir: string) {
  const projects = `${homeDir}/.claude/projects`
  const project = `${projects}/-work`
  const files = new Map<string, string>()
  for (let index = 0; index < 4; index++) {
    files.set(`${project}/s-${index}.jsonl`, `${JSON.stringify({ type: "user", cwd: "/work", sessionId: `s-${index}`, message: { role: "user", content: "hi" } })}\n`)
  }
  const directories = new Map<string, string[]>([
    [projects, ["-work"]],
    [project, [...files.keys()].map((path) => path.slice(project.length + 1))],
  ])
  const now = Date.now()
  const statOf = (path: string): SessionHistoryFileStats => {
    const file = files.get(path)
    if (file !== undefined) return { type: "File", size: file.length, mtimeMs: now, dev: 1, ino: path.length, birthtimeMs: now }
    if (directories.has(path) || path === "/work" || path === homeDir) return { type: "Directory", size: 0, mtimeMs: now, dev: 1, ino: path.length + 1000, birthtimeMs: now }
    throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" })
  }
  const calls: string[] = []
  const pending: Array<() => void> = []
  const gate = async <T>(label: string, answer: () => T): Promise<T> => {
    calls.push(label)
    await new Promise<void>((resolve) => pending.push(resolve))
    return answer()
  }
  const file = (path: string): SessionHistoryFile => {
    let offset = 0
    return {
      read: (size) => gate(`read ${path}`, () => {
        const bytes = new TextEncoder().encode(files.get(path) ?? "").subarray(offset, offset + size)
        offset += bytes.byteLength
        return bytes.byteLength === 0 ? null : bytes
      }),
      stat: () => gate(`fstat ${path}`, () => statOf(path)),
      close: () => Promise.resolve(),
    }
  }
  const fs: SessionHistoryFs = {
    readDirectory: (path) => gate(`readdir ${path}`, () => {
      const entries = directories.get(path)
      if (entries === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" })
      return entries
    }),
    stat: (path) => gate(`stat ${path}`, () => statOf(path)),
    realPath: (path) => gate(`realpath ${path}`, () => path),
    readFileString: (path) => gate(`readFile ${path}`, () => files.get(path) ?? ""),
    open: (path) => gate(`open ${path}`, () => file(path)),
  }
  return {
    fs,
    calls,
    async releaseAll(): Promise<void> {
      for (const release of pending.splice(0)) release()
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}
