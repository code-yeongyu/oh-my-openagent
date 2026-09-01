import { afterEach, describe, expect, test } from "bun:test"

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createReadToolDefinition, type CreateAgentSessionOptions, type ToolDefinition } from "@code-yeongyu/senpi"

import { InProcessRunner, RunnerError } from "./in-process"
import type { ChildSession, ChildSessionListener, ChildSpec } from "./in-process"

const sampleParameters = createReadToolDefinition(process.cwd()).parameters

function makeTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: sampleParameters,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

type FakeSessionControls = {
  readonly session: ChildSession
  readonly lastText: { value: string | undefined }
  promptCalls: () => number
  resolvePrompt: () => void
}

// Controllable ChildSession: prompt() is a turn that settles on demand.
function createFakeSession(sessionId = "resume-session-1"): FakeSessionControls {
  const lastText = { value: undefined as string | undefined }
  const counters = { promptCalls: 0 }
  let settle: (() => void) | undefined
  const session: ChildSession = {
    sessionId,
    prompt() {
      counters.promptCalls += 1
      return new Promise<void>((resolve) => {
        settle = resolve
      })
    },
    async steer() {},
    async followUp() {},
    async abort() {},
    subscribe(_listener: ChildSessionListener) {
      return () => {}
    },
    getLastAssistantText() {
      return lastText.value
    },
    dispose() {},
  }
  return {
    session,
    lastText,
    promptCalls: () => counters.promptCalls,
    resolvePrompt: () => settle?.(),
  }
}

// A session whose single turn settles immediately with fresh assistant text.
function immediateSession(onPrompt?: () => void): ChildSession {
  const lastText = { value: undefined as string | undefined }
  return {
    sessionId: "resume-immediate",
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

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-task-resume-"))
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
  id: "resume-test-session",
  timestamp: "2026-08-04T00:00:00.000Z",
  cwd: "/tmp",
})

function writeSessionFile(dir: string): string {
  const path = join(dir, "session.jsonl")
  writeFileSync(path, `${SESSION_HEADER}\n`)
  return path
}

function baseSpec(overrides: Partial<ChildSpec> = {}): ChildSpec {
  const taskId = overrides.taskId ?? "task-resume-1"
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

describe("InProcessRunner resume", () => {
  test("#given a curated spec with allowlist, denylist, and member-scoped names #when resumed #then the tool surface matches the start surface exactly", async () => {
    // given a curated agent whose start path builds the full tool surface
    const taskSend = makeTool("task_send")
    const parentBash = makeTool("bash")
    const captured: CreateAgentSessionOptions[] = []
    const runner = new InProcessRunner({
      sharedParentTools: [makeTool("grep"), parentBash, taskSend, makeTool("task_create")],
      createSession: async (options) => {
        captured.push(options)
        return immediateSession()
      },
    })
    const spec = baseSpec({
      agentType: "explore",
      toolAllowlist: ["read", "bash", "task_send"],
      toolDenylist: ["grep"],
      memberScopedTools: [taskSend],
      memberScopedToolNames: ["task_send"],
    })
    const sessionPath = writeSessionFile(makeTmpDir())

    // when the child is started and later resumed from its transcript
    const started = await runner.start(spec)
    await started.waitForIdle()
    await runner.resume(spec, sessionPath)

    // then both builds produce the SAME surface
    const [startOptions, resumeOptions] = captured
    const startNames = (startOptions?.customTools ?? []).map((tool) => tool.name)
    const resumeNames = (resumeOptions?.customTools ?? []).map((tool) => tool.name)
    expect(resumeNames).toEqual(startNames)
    // the task/team family stays excluded; the member-scoped tool is re-resolved against the LIVE instance
    expect(resumeNames).not.toContain("task_create")
    expect((resumeOptions?.customTools ?? []).find((tool) => tool.name === "task_send")).toBe(taskSend)
    // the curated read-only bash override is reinstalled over the parent's builtin bash
    const resumeBash = (resumeOptions?.customTools ?? []).filter((tool) => tool.name === "bash")
    expect(resumeBash).toHaveLength(1)
    expect(resumeBash[0]?.description).toContain("read-only")
    expect(resumeBash[0]).not.toBe(parentBash)
    // the allowlist and the denylist are re-applied through the same fields as start
    expect(resumeOptions?.tools).toEqual(["read", "bash", "task_send"])
    expect(resumeOptions?.excludeTools).toEqual(["grep"])
    // a denied tool stays absent from the effective surface AFTER resume
    const effective = resumeNames.filter((name) => !(resumeOptions?.excludeTools ?? []).includes(name))
    expect(effective).not.toContain("grep")
  })

  test("#given a resumed child #when the handle is created #then no prompt is sent and the next follow-up starts a fresh tracked turn", async () => {
    // given a resumable transcript and a fake session with prior output
    const fake = createFakeSession()
    fake.lastText.value = "restored text"
    const runner = new InProcessRunner({
      createSession: async () => fake.session,
    })
    const sessionPath = writeSessionFile(makeTmpDir())

    // when the child is resumed
    const handle = await runner.resume(baseSpec(), sessionPath)

    // then the original prompt is NOT replayed and the idle handle drains the transcript outcome
    expect(fake.promptCalls()).toBe(0)
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "restored text" })

    // and when a follow-up arrives, a fresh tracked turn runs
    await handle.followUp("keep going")
    expect(fake.promptCalls()).toBe(1)
    fake.lastText.value = "new text"
    fake.resolvePrompt()
    expect(await handle.waitForIdle()).toEqual({ status: "completed", finalResponse: "new text" })
  })

  test("#given a member-scoped name missing from the live parent tools #when resumed #then a typed tools_unavailable failure surfaces and no session is created", async () => {
    // given a persisted name that no live tool provides
    let createCalls = 0
    const runner = new InProcessRunner({
      sharedParentTools: [makeTool("grep")],
      createSession: async () => {
        createCalls += 1
        return immediateSession()
      },
    })
    const sessionPath = writeSessionFile(makeTmpDir())

    // when
    const resume = runner.resume(baseSpec({ memberScopedToolNames: ["task_send"] }), sessionPath)

    // then the failure is TYPED (retryable), never a silently weakened tool set
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "tools_unavailable" } })
    expect(createCalls).toBe(0)
  })

  test("#given a duplicated member-scoped name #when resumed #then a typed tools_unavailable failure surfaces", async () => {
    // given a spec whose persisted names carry a duplicate
    const runner = new InProcessRunner({
      sharedParentTools: [makeTool("task_send")],
      createSession: async () => immediateSession(),
    })
    const sessionPath = writeSessionFile(makeTmpDir())

    // when
    const resume = runner.resume(baseSpec({ memberScopedToolNames: ["task_send", "task_send"] }), sessionPath)

    // then
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "tools_unavailable" } })
  })

  test("#given a member-scoped name matching two live tools #when resumed #then a typed tools_unavailable failure surfaces", async () => {
    // given an ambiguous live tool set
    const runner = new InProcessRunner({
      sharedParentTools: [makeTool("task_send"), makeTool("task_send")],
      createSession: async () => immediateSession(),
    })
    const sessionPath = writeSessionFile(makeTmpDir())

    // when
    const resume = runner.resume(baseSpec({ memberScopedToolNames: ["task_send"] }), sessionPath)

    // then
    await expect(resume).rejects.toBeInstanceOf(RunnerError)
    await expect(resume).rejects.toMatchObject({ failure: { kind: "tools_unavailable" } })
  })
})
