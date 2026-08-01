import { expect, test } from "bun:test"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { InProcessRunner, type ChildSession, type ChildSpec } from "./in-process"

test("#given a parent model runtime #when the child session is constructed #then native providers remain executable", async () => {
  // given
  let captured: CreateAgentSessionOptions | undefined
  const modelRuntime = { kind: "native-provider-runtime" } as unknown as NonNullable<
    CreateAgentSessionOptions["modelRuntime"]
  >
  const session: ChildSession = {
    sessionId: "child-session",
    prompt: () => Promise.resolve(),
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    subscribe: () => () => {},
    getLastAssistantText: () => undefined,
    dispose() {},
  }
  const spec: ChildSpec = {
    taskId: "task-1",
    cwd: process.cwd(),
    modelRuntime,
    depth: 0,
    parentSessionId: "parent-1",
    rootSessionId: "root-1",
    prompt: "do the work",
  }
  const runner = new InProcessRunner({
    createSession: async (options) => {
      captured = options
      return session
    },
  })

  // when
  const handle = await runner.start(spec)
  await handle.waitForIdle()

  // then
  expect(captured?.modelRuntime).toBe(modelRuntime)
})
