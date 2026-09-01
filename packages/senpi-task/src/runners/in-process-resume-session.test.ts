import { afterEach, describe, expect, test } from "bun:test"

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { InProcessRunner, RunnerError } from "./in-process"
import type { ChildSession, ChildSpec } from "./in-process"
import { resolveChildSessionDir } from "./rpc/spawn"

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-task-resume-session-"))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() ?? "", { recursive: true, force: true })
  }
})

const SESSION_HEADER = JSON.stringify({
  type: "session",
  id: "resume-session-file",
  timestamp: "2026-08-04T00:00:00.000Z",
  cwd: "/tmp",
})

function writeSessionFile(dir: string, content = `${SESSION_HEADER}\n`): string {
  const path = join(dir, "session.jsonl")
  writeFileSync(path, content)
  return path
}

// A session whose single turn settles immediately with fresh assistant text.
function immediateSession(onPrompt?: () => void): ChildSession {
  const lastText = { value: undefined as string | undefined }
  return {
    sessionId: "resume-session-file-fake",
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
  const taskId = overrides.taskId ?? "task-resume-session-1"
  return {
    taskId,
    cwd: process.cwd(),
    sessionDir: join(makeTmpDir(), "sessions", taskId),
    depth: 0,
    parentSessionId: "parent-1",
    rootSessionId: "root-1",
    prompt: "do the work",
    ...overrides,
  }
}

describe("InProcessRunner resume session file failures", () => {
  test("#given a corrupt session file #when resumed #then a typed session_unavailable failure surfaces and no raw parse error escapes", async () => {
    // given a transcript whose content is not parseable session JSONL
    const sessionPath = writeSessionFile(makeTmpDir(), "this is not json\n{nope\n")
    let createCalls = 0
    const runner = new InProcessRunner({
      createSession: async () => {
        createCalls += 1
        return immediateSession()
      },
    })

    // when
    const resume = runner.resume(baseSpec(), sessionPath)

    // then the failure is TYPED - senpi's tolerant loader would otherwise resurrect an empty transcript
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "session_unavailable" } })
    expect(createCalls).toBe(0)
  })

  test("#given a missing session file #when resumed #then a typed session_unavailable failure surfaces", async () => {
    // given a sessionPath that does not exist
    const sessionPath = join(makeTmpDir(), "does-not-exist.jsonl")
    const runner = new InProcessRunner({
      createSession: async () => immediateSession(),
    })

    // when
    const resume = runner.resume(baseSpec(), sessionPath)

    // then
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "session_unavailable" } })
  })

  test("#given a directory as the session path #when resumed #then a typed session_unavailable failure surfaces", async () => {
    // given an unreadable-as-file sessionPath
    const sessionPath = join(makeTmpDir(), "a-directory")
    mkdirSync(sessionPath)
    const runner = new InProcessRunner({
      createSession: async () => immediateSession(),
    })

    // when
    const resume = runner.resume(baseSpec(), sessionPath)

    // then
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "session_unavailable" } })
  })

  test("#given a session file whose first entry is not a session header #when resumed #then a typed session_unavailable failure surfaces", async () => {
    // given parseable JSONL that is not a session transcript (stale/foreign layout)
    const sessionPath = writeSessionFile(
      makeTmpDir(),
      `${JSON.stringify({ type: "message", id: "m1", role: "user" })}\n`,
    )
    const runner = new InProcessRunner({
      createSession: async () => immediateSession(),
    })

    // when
    const resume = runner.resume(baseSpec(), sessionPath)

    // then
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "session_unavailable" } })
  })

  test("#given a legacy spec without a sessionDir #when resumed #then a typed session-create failure surfaces instead of a silent default-dir fallback", async () => {
    // given a stale, pre-persistence spec shape (untyped data crossing the boundary)
    const legacySpec: ChildSpec = JSON.parse(
      JSON.stringify({
        taskId: "task-legacy-resume",
        cwd: process.cwd(),
        depth: 0,
        parentSessionId: "parent-1",
        rootSessionId: "root-1",
        prompt: "do the work",
      }),
    )
    const sessionPath = writeSessionFile(makeTmpDir())
    let createCalls = 0
    const runner = new InProcessRunner({
      createSession: async () => {
        createCalls += 1
        return immediateSession()
      },
    })

    // when
    const resume = runner.resume(legacySpec, sessionPath)

    // then
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "session-create-failed" } })
    expect(createCalls).toBe(0)
  })

  test("#given a real persisted child transcript written by the start path #when resumed #then the same session file is reopened and a follow-up produces a tracked turn", async () => {
    // given a child that ran one turn through the real SessionManager persistence machinery
    const taskId = "task-resume-integration"
    const sessionDir = resolveChildSessionDir(join(makeTmpDir(), "children", taskId), taskId)
    const spec = baseSpec({ taskId, sessionDir })
    const captured: CreateAgentSessionOptions[] = []
    const appendTurn = (options: CreateAgentSessionOptions): void => {
      const sessionManager = options.sessionManager
      if (sessionManager === undefined) throw new Error("expected the runner to pass a sessionManager")
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
    const sessionManagerOf = (index: number) => {
      const sessionManager = captured[index]?.sessionManager
      if (sessionManager === undefined) throw new Error("expected the runner to pass a sessionManager")
      return sessionManager
    }
    const runner = new InProcessRunner({
      createSession: async (options) => {
        captured.push(options)
        return immediateSession(() => appendTurn(options))
      },
    })
    const started = await runner.start(spec)
    expect((await started.waitForIdle()).status).toBe("completed")
    const transcripts = readdirSync(sessionDir).filter((entry) => entry.endsWith(".jsonl"))
    expect(transcripts).toHaveLength(1)
    const sessionPath = join(sessionDir, transcripts[0] ?? "")

    // when the child is resumed from that transcript
    const resumed = await runner.resume(spec, sessionPath)

    // then the SAME file is reopened - no new transcript, no truncation
    expect(readdirSync(sessionDir).filter((entry) => entry.endsWith(".jsonl"))).toHaveLength(1)
    expect(readFileSync(sessionPath, "utf8")).toContain("child prompt marker")
    expect(sessionManagerOf(1).isPersisted()).toBe(true)
    expect(sessionManagerOf(1).getSessionDir()).toBe(sessionManagerOf(0).getSessionDir())

    // and a follow-up produces a fresh tracked turn against the restored session
    await resumed.followUp("continue")
    expect(await resumed.waitForIdle()).toEqual({ status: "completed", finalResponse: "done" })
  })
})
