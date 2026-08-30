import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createReadToolDefinition, type CreateAgentSessionOptions, type ToolDefinition } from "@code-yeongyu/senpi"

import { InProcessRunner, type ChildSession, type ChildSpec } from "./in-process"

const sampleParameters = createReadToolDefinition(process.cwd()).parameters
const tempDirs: string[] = []

function makeTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: sampleParameters,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-task-dag-child-policy-"))
  tempDirs.push(dir)
  return dir
}

function makeSession(): ChildSession {
  return {
    sessionId: "dag-policy-session",
    prompt: () => Promise.resolve(),
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    getLastAssistantText: () => "done",
    dispose: () => Promise.resolve(),
  }
}

function childSpec(overrides: Partial<ChildSpec> = {}): ChildSpec {
  return {
    taskId: "st_dag_policy",
    cwd: process.cwd(),
    sessionDir: join(makeTempDir(), "sessions", "st_dag_policy"),
    depth: 1,
    parentSessionId: "parent-session",
    rootSessionId: "root-session",
    prompt: "execute the DAG node",
    ...overrides,
  }
}

function writeSessionTranscript(): string {
  const path = join(makeTempDir(), "session.jsonl")
  writeFileSync(path, `${JSON.stringify({
    type: "session",
    id: "dag-policy-session",
    timestamp: "2026-08-14T00:00:00.000Z",
    cwd: process.cwd(),
  })}\n`)
  return path
}

function names(options: CreateAgentSessionOptions | undefined): readonly string[] {
  return (options?.customTools ?? []).map((tool) => tool.name)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("DAG child in-process tool policy", () => {
  test("#given a DAG node child #when its session options are built #then no orchestration-capable shared tool reaches it", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const runner = new InProcessRunner({
      sharedParentTools: [
        makeTool("grep"),
        makeTool("task"),
        makeTool("task_create"),
        makeTool("task_send"),
        makeTool("team_create"),
        makeTool("workflow"),
      ],
      createSession: async (options) => {
        captured = options
        return makeSession()
      },
    })

    // when
    const handle = await runner.start(childSpec())
    await handle.waitForIdle()

    // then
    expect(names(captured)).toEqual(["grep"])
  })

  test("#given a persisted DAG node child #when resumed #then the shared orchestration filter is re-applied", async () => {
    // given
    let captured: CreateAgentSessionOptions | undefined
    const runner = new InProcessRunner({
      sharedParentTools: [makeTool("grep"), makeTool("task_update"), makeTool("team_send"), makeTool("workflow")],
      createSession: async (options) => {
        captured = options
        return makeSession()
      },
    })

    // when
    await runner.resume(childSpec(), writeSessionTranscript())

    // then
    expect(names(captured)).toEqual(["grep"])
  })

  test("#given plain and team-member children #when their tool sets are built #then existing sanctioned sets stay exact and the workflow orchestrator is absent", async () => {
    // given
    const shared = [makeTool("grep"), makeTool("task"), makeTool("team_create"), makeTool("workflow")]
    const taskSend = makeTool("task_send")
    const captured: CreateAgentSessionOptions[] = []
    const runner = new InProcessRunner({
      sharedParentTools: shared,
      createSession: async (options) => {
        captured.push(options)
        return makeSession()
      },
    })

    // when
    const plain = await runner.start(childSpec({ taskId: "st_plain" }))
    const member = await runner.start(childSpec({
      taskId: "st_member",
      memberScopedTools: [taskSend],
      memberScopedToolNames: ["task_send"],
    }))
    await Promise.all([plain.waitForIdle(), member.waitForIdle()])

    // then
    expect(names(captured[0])).toEqual(["grep"])
    expect(names(captured[1])).toEqual(["grep", "task_send"])
  })
})
