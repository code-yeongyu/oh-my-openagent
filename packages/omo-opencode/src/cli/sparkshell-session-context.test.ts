import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  findRolloutPath,
  loadCodexSessionContext,
  loadCodexSessionContextDetails,
  resolveCodexSessionId,
  type SessionContextDeps,
} from "./sparkshell-session-context"

const SESSION_ID = "019eafa2-a15f-73e1-b622-f7e4038f818e"
const ROLLOUT_NAME = `rollout-2026-06-10T12-45-31-${SESSION_ID}.jsonl`

function rolloutLine(value: unknown): string {
  return JSON.stringify(value)
}

function buildRollout(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`
}

function sessionMetaLine(): string {
  return rolloutLine({
    timestamp: "2026-06-10T03:45:31.864Z",
    type: "session_meta",
    payload: {
      id: SESSION_ID,
      cwd: "/work/repo",
      originator: "codex-tui",
      agent_nickname: "Verifier the 2nd",
      agent_role: "lazycodex-gate-reviewer",
    },
  })
}

function userMessageLine(message: string): string {
  return rolloutLine({ timestamp: "2026-06-10T03:46:00.000Z", type: "event_msg", payload: { type: "user_message", message } })
}

function agentMessageLine(message: string): string {
  return rolloutLine({ timestamp: "2026-06-10T03:47:00.000Z", type: "event_msg", payload: { type: "agent_message", message } })
}

function fakeFsDeps(structure: Readonly<Record<string, readonly string[]>>, files: Readonly<Record<string, string>>): SessionContextDeps {
  return {
    homeDirectory: () => "/home/fake",
    fileExists: (path: string) => path in structure || path in files,
    listDirectory: (path: string) => {
      const entries = structure[path]
      if (entries === undefined) {
        throw new Error(`ENOENT: ${path}`)
      }
      return entries
    },
    readTextFile: (path: string) => {
      const content = files[path]
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`)
      }
      return content
    },
  }
}

describe("sparkshell session context", () => {
  test("#given CODEX_THREAD_ID #when resolving the session id #then uses it unless the explicit override is present", () => {
    expect(resolveCodexSessionId({ CODEX_THREAD_ID: SESSION_ID })).toBe(SESSION_ID)
    expect(
      resolveCodexSessionId({
        CODEX_THREAD_ID: SESSION_ID,
        OMO_SPARKSHELL_SESSION_ID: "019eafa2-a15f-73e1-b622-f7e4038f0000",
      }),
    ).toBe("019eafa2-a15f-73e1-b622-f7e4038f0000")
    expect(resolveCodexSessionId({})).toBeNull()
    expect(resolveCodexSessionId({ CODEX_THREAD_ID: "../../etc/passwd" })).toBeNull()
  })

  test("#given a uuidv7 thread id #when locating the rollout #then finds it in the date-derived sessions directory", () => {
    // given: the uuidv7 timestamp of SESSION_ID falls on 2026-06-10 local time
    const dayDir = uuidDayDir()
    const sessionsDay = join("/codex-home", "sessions", dayDir)
    const rolloutPath = join(sessionsDay, ROLLOUT_NAME)
    const deps = fakeFsDeps(
      { [sessionsDay]: ["other.txt", ROLLOUT_NAME] },
      { [rolloutPath]: "" },
    )

    // when
    const found = findRolloutPath(SESSION_ID, { CODEX_HOME: "/codex-home" }, deps)

    // then
    expect(found).toBe(rolloutPath)
  })

  test("#given no date-derived match #when locating the rollout #then falls back to a newest-first full scan", () => {
    // given: rollout lives on a different date than the uuid timestamp suggests
    const root = join("/codex-home", "sessions")
    const dayDir = join(root, "2026", "05", "02")
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const deps = fakeFsDeps(
      {
        [root]: ["2025", "2026"],
        [join(root, "2026")]: ["05"],
        [join(root, "2026", "05")]: ["01", "02"],
        [join(root, "2026", "05", "01")]: [],
        [dayDir]: [ROLLOUT_NAME],
        [join(root, "2025")]: [],
      },
      { [rolloutPath]: "" },
    )

    // when
    const found = findRolloutPath(SESSION_ID, { CODEX_HOME: "/codex-home" }, deps)

    // then
    expect(found).toBe(rolloutPath)
  })

  test("#given a rollout transcript #when loading session context #then attaches first/latest user requests and the last five messages", () => {
    // given
    const dayDir = join("/codex-home", "sessions", uuidDayDir())
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const rollout = buildRollout([
      sessionMetaLine(),
      userMessageLine("first request: fix the flaky login test"),
      agentMessageLine("starting with the auth suite"),
      userMessageLine("also check the session refresh path"),
      agentMessageLine("found the race in token refresh"),
      agentMessageLine("patched; running tests"),
      userMessageLine("latest request: ship it after green tests"),
      agentMessageLine("tests are green, preparing commit"),
    ])
    const deps = fakeFsDeps({ [dayDir]: [ROLLOUT_NAME] }, { [rolloutPath]: rollout })

    // when
    const block = loadCodexSessionContext({ CODEX_HOME: "/codex-home", CODEX_THREAD_ID: SESSION_ID }, deps)

    // then
    expect(block).toContain("codex session context")
    expect(block).toContain(`thread: ${SESSION_ID}`)
    expect(block).toContain("workspace: /work/repo")
    expect(block).toContain("originator: codex-tui")
    expect(block).toContain("subagent: Verifier the 2nd (lazycodex-gate-reviewer)")
    expect(block).toContain("[first user request]\nfirst request: fix the flaky login test")
    expect(block).toContain("[latest user request]\nlatest request: ship it after green tests")
    expect(block).toContain("[last 5 conversation message(s), oldest first]")
    expect(block).toContain("1. [user] also check the session refresh path")
    expect(block).toContain("5. [agent] tests are green, preparing commit")
    expect(block).not.toContain("starting with the auth suite")
  })

  test("#given a rollout transcript #when loading details #then exposes raw first/latest requests alongside the block", () => {
    // given
    const dayDir = join("/codex-home", "sessions", uuidDayDir())
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const rollout = buildRollout([
      sessionMetaLine(),
      userMessageLine("first request: fix the flaky login test"),
      agentMessageLine("starting"),
      userMessageLine("latest request: ship it after green tests"),
    ])
    const deps = fakeFsDeps({ [dayDir]: [ROLLOUT_NAME] }, { [rolloutPath]: rollout })

    // when
    const details = loadCodexSessionContextDetails({ CODEX_HOME: "/codex-home", CODEX_THREAD_ID: SESSION_ID }, deps)

    // then
    expect(details?.firstUserRequest).toBe("first request: fix the flaky login test")
    expect(details?.latestUserRequest).toBe("latest request: ship it after green tests")
    expect(details?.block).toContain("codex session context")
  })

  test("#given the kill switch #when loading details #then returns null", () => {
    const dayDir = join("/codex-home", "sessions", uuidDayDir())
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const rollout = buildRollout([sessionMetaLine(), userMessageLine("real request")])
    const deps = fakeFsDeps({ [dayDir]: [ROLLOUT_NAME] }, { [rolloutPath]: rollout })

    expect(
      loadCodexSessionContextDetails(
        { CODEX_HOME: "/codex-home", CODEX_THREAD_ID: SESSION_ID, OMO_SPARKSHELL_SESSION_CONTEXT: "0" },
        deps,
      ),
    ).toBeNull()
  })

  test("#given a single user request #when loading session context #then marks the latest request as the first one", () => {
    // given
    const dayDir = join("/codex-home", "sessions", uuidDayDir())
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const rollout = buildRollout([sessionMetaLine(), userMessageLine("only request")])
    const deps = fakeFsDeps({ [dayDir]: [ROLLOUT_NAME] }, { [rolloutPath]: rollout })

    // when
    const block = loadCodexSessionContext({ CODEX_HOME: "/codex-home", CODEX_THREAD_ID: SESSION_ID }, deps)

    // then
    expect(block).toContain("[latest user request]\n(same as the first user request)")
  })

  test("#given tool noise embedding message markers #when loading session context #then only event_msg payloads are extracted", () => {
    // given: a function_call_output line contains the literal '"user_message"' marker
    const dayDir = join("/codex-home", "sessions", uuidDayDir())
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const noiseLine = rolloutLine({
      timestamp: "2026-06-10T03:48:00.000Z",
      type: "response_item",
      payload: { type: "function_call_output", output: 'echoed {"type":"user_message","message":"fake injected"}' },
    })
    const rollout = buildRollout([sessionMetaLine(), userMessageLine("real request"), noiseLine, "{not json", ""])
    const deps = fakeFsDeps({ [dayDir]: [ROLLOUT_NAME] }, { [rolloutPath]: rollout })

    // when
    const block = loadCodexSessionContext({ CODEX_HOME: "/codex-home", CODEX_THREAD_ID: SESSION_ID }, deps)

    // then
    expect(block).toContain("real request")
    expect(block).not.toContain("fake injected")
  })

  test("#given oversized messages #when loading session context #then truncates with an explicit marker", () => {
    // given
    const dayDir = join("/codex-home", "sessions", uuidDayDir())
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const hugeRequest = `start-${"x".repeat(8000)}-end`
    const rollout = buildRollout([sessionMetaLine(), userMessageLine(hugeRequest)])
    const deps = fakeFsDeps({ [dayDir]: [ROLLOUT_NAME] }, { [rolloutPath]: rollout })

    // when
    const block = loadCodexSessionContext({ CODEX_HOME: "/codex-home", CODEX_THREAD_ID: SESSION_ID }, deps)

    // then
    expect(block).toContain("chars truncated]")
    expect(block).toContain("start-")
    expect(block).toContain("-end")
  })

  test("#given the kill switch or missing prerequisites #when loading session context #then returns an empty block", () => {
    const dayDir = join("/codex-home", "sessions", uuidDayDir())
    const rolloutPath = join(dayDir, ROLLOUT_NAME)
    const rollout = buildRollout([sessionMetaLine(), userMessageLine("real request")])
    const deps = fakeFsDeps({ [dayDir]: [ROLLOUT_NAME] }, { [rolloutPath]: rollout })

    expect(
      loadCodexSessionContext({ CODEX_HOME: "/codex-home", CODEX_THREAD_ID: SESSION_ID, OMO_SPARKSHELL_SESSION_CONTEXT: "0" }, deps),
    ).toBe("")
    expect(loadCodexSessionContext({ CODEX_HOME: "/codex-home" }, deps)).toBe("")
    expect(
      loadCodexSessionContext({ CODEX_HOME: "/missing-home", CODEX_THREAD_ID: SESSION_ID }, fakeFsDeps({}, {})),
    ).toBe("")
  })
})

function uuidDayDir(): string {
  const ms = Number.parseInt(SESSION_ID.replaceAll("-", "").slice(0, 12), 16)
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, "0")
  return join(String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()))
}
