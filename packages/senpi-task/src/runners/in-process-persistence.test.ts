import { afterEach, describe, expect, test } from "bun:test"

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

import type { CreateAgentSessionOptions, SessionManager } from "@code-yeongyu/senpi"

import { InProcessRunner, RunnerError } from "./in-process"
import type { ChildSession, ChildSpec } from "./in-process"
import { resolveChildSessionDir } from "./rpc/spawn"

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-task-persistence-"))
  tmpDirs.push(dir)
  return dir

}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() ?? "", { recursive: true, force: true })
  }
})

function completedSession(onPrompt?: () => void): ChildSession {
  // Mutable last-assistant text: the handle's turn outcome diffs against the pre-turn baseline, so
  // a constant "done" would read as stale output and fail the turn.
  const lastText = { value: undefined as string | undefined }
  return {
    sessionId: "child-persistence",
    prompt: () => {
      onPrompt?.()
      lastText.value = "done"
      return Promise.resolve()
    },
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    getLastAssistantText: () => lastText.value,
    dispose: () => {},
  }
}

function baseSpec(overrides: Partial<ChildSpec> = {}): ChildSpec {
  const taskId = overrides.taskId ?? "task-persist-1"
  return {
    taskId,
    cwd: process.cwd(),
    sessionDir: resolveChildSessionDir(join(makeTmpDir(), "children", taskId), taskId),
    depth: 0,
    parentSessionId: "parent-1",
    rootSessionId: "root-1",
    prompt: "do the work",
    ...overrides,
  }
}

function capturedSessionManager(captured: CreateAgentSessionOptions | undefined): SessionManager {
  const sessionManager = captured?.sessionManager
  if (sessionManager === undefined) throw new Error("expected the runner to pass a sessionManager")
  return sessionManager
}

describe("InProcessRunner session persistence", () => {
  test("#given a child spec with a resolved child session dir #when started #then the session manager persists under children/<taskId>/sessions/", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return completedSession()
      },
    })
    const spec = baseSpec()

    // when
    const handle = await runner.start(spec)
    await handle.waitForIdle()

    // then
    const sessionManager = capturedSessionManager(captured)
    expect(sessionManager.isPersisted()).toBe(true)
    expect(sessionManager.getSessionDir()).toContain(join("children", spec.taskId, "sessions", spec.taskId))
  })

  test("#given allow and deny tool lists #when the child session is constructed #then tools carries the allowlist and excludeTools carries the denylist", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return completedSession()
      },
    })

    // when
    const handle = await runner.start(
      baseSpec({ toolAllowlist: ["read", "bash"], toolDenylist: ["write", "edit"] }),
    )
    await handle.waitForIdle()

    // then
    expect(captured?.tools).toEqual(["read", "bash"])
    expect(captured?.excludeTools).toEqual(["write", "edit"])
  })

  test("#given no tool denylist #when the child session is constructed #then excludeTools stays unset so senpi keeps its defaults", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return completedSession()
      },
    })

    // when
    const handle = await runner.start(baseSpec({ toolAllowlist: ["read"] }))
    await handle.waitForIdle()

    // then
    expect(captured?.tools).toEqual(["read"])
    expect(captured?.excludeTools).toBeUndefined()
  })

  test("#given an unwritable session dir #when start is called #then a typed session-create failure surfaces with no in-memory fallback", async () => {
    // given a regular file where the child session dir must be created (mkdir fails ENOTDIR)
    const blocker = join(makeTmpDir(), "blocker")
    writeFileSync(blocker, "not a directory")
    let createCalls = 0
    const runner = new InProcessRunner({
      createSession: async () => {
        createCalls += 1
        return completedSession()
      },
    })

    // when
    const start = runner.start(baseSpec({ sessionDir: `${join(blocker, "sessions", "task-x")}${sep}` }))

    // then
    await expect(start).rejects.toBeInstanceOf(RunnerError)
    await expect(start).rejects.toMatchObject({ failure: { kind: "session-create-failed" } })
    expect(createCalls).toBe(0)
  })

  test("#given a legacy spec without a sessionDir #when start is called #then a typed session-create failure surfaces instead of a silent default-dir fallback", async () => {
    // given a stale, pre-persistence spec shape (untyped data crossing the boundary)
    const legacySpec: ChildSpec = JSON.parse(
      JSON.stringify({
        taskId: "task-legacy",
        cwd: process.cwd(),
        depth: 0,
        parentSessionId: "parent-1",
        rootSessionId: "root-1",
        prompt: "do the work",
      }),
    )
    let createCalls = 0
    const runner = new InProcessRunner({
      createSession: async () => {
        createCalls += 1
        return completedSession()
      },
    })

    // when
    const start = runner.start(legacySpec)

    // then
    await expect(start).rejects.toBeInstanceOf(RunnerError)
    await expect(start).rejects.toMatchObject({ failure: { kind: "session-create-failed" } })
    expect(createCalls).toBe(0)
  })

  test("#given the real default session manager #when one stubbed turn runs #then a jsonl transcript with the child messages appears under the session dir", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const spec = baseSpec()
    const appendTurn = (): void => {
      const sessionManager = capturedSessionManager(captured)
      const stamp = Date.now()
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "child prompt marker" }],
        timestamp: stamp,
      })
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "child assistant marker" }],
        api: "faux-api",
        provider: "faux-provider",
        model: "faux-model",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: stamp,
      })
    }
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured = options
        return completedSession(appendTurn)
      },
    })

    // when
    const handle = await runner.start(spec)
    const outcome = await handle.waitForIdle()

    // then
    expect(outcome).toEqual({ status: "completed", finalResponse: "done" })
    const sessionDir = capturedSessionManager(captured).getSessionDir()
    const transcripts = readdirSync(sessionDir).filter((entry) => entry.endsWith(".jsonl"))
    expect(transcripts).toHaveLength(1)
    const transcript = readFileSync(join(sessionDir, transcripts[0] ?? ""), "utf8")
    expect(transcript).toContain("child prompt marker")
    expect(transcript).toContain("child assistant marker")
  })
})
