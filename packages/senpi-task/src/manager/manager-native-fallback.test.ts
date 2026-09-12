import { afterEach, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"

import { createFallbackSessionHarness } from "../runners/__fixtures__/in-process-fallback-session"
import { createChildHandle } from "../runners/in-process/child-handle"
import { createRpcChildHandle } from "../runners/rpc/handle"
import { RpcProtocolClient } from "../runners/rpc/protocol-client"
import { createTaskRecordStore } from "../store"
import { baseSpec, cleanupProjects, settings, tempProject } from "./__fixtures__/manager-fakes"
import { adaptInProcessHandle, adaptRpcHandle } from "./child-handle"
import { createTaskManager } from "./manager"
import type { ManagedRunner } from "./types"

afterEach(cleanupProjects)

test.each(["in-process", "process"] as const)("#given native Senpi fallback state over %s #when a bare fallback event follows model admission #then running and completed records retain actual effort", async (mode) => {
  // given: hold each provider response, rather than race manager subscription or completion.
  const primaryResponse = Promise.withResolvers<() => void>()
  const fallbackResponse = Promise.withResolvers<() => void>()
  const harness = await createFallbackSessionHarness(
    `403: {"message":"You've reached your usage limit for this billing cycle.","type":"access_terminated_error"}`,
    {
      fallbackEffort: "high",
      scheduleResponse(model, respond) {
        if (model === "dead-primary") primaryResponse.resolve(respond)
        else fallbackResponse.resolve(respond)
      },
    },
  )
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  // Feed the real SDK events as JSONL through the production RPC client/handle too.
  // An echo subprocess supplies the pipe; no invented fallback payload or cached get_state.
  const child = spawn("node", ["-e", "process.stdin.pipe(process.stdout)"], { stdio: ["pipe", "pipe", "pipe"] })
  const closed = once(child, "close")
  const client = new RpcProtocolClient({ child })
  const rpc = createRpcChildHandle({ client, child, taskId: "wire-child", heartbeatIntervalMs: 60_000, now: Date.now })
  const unsubscribeWire = harness.session.subscribe((event) => child.stdin.write(`${JSON.stringify(event)}\n`))
  const runner: ManagedRunner = {
    start: async (spec) => {
      const inProcess = createChildHandle({ taskId: spec.taskId, session: harness.session, promptText: spec.prompt })
      return mode === "in-process" ? adaptInProcessHandle(inProcess) : adaptRpcHandle({ ...rpc, task_id: spec.taskId })
    },
  }
  const manager = createTaskManager({
    cwd: project,
    store,
    runners: { "in-process": runner, process: runner },
    config: settings(),
    planner: () => ({
      kind: "resolved",
      plan: {
        model: "runtime-fallback-test/dead-primary",
        category: "quick",
        resolved_model: {
          source: "category",
          provider: "runtime-fallback-test",
          model_id: "dead-primary",
          display: "runtime-fallback-test/dead-primary",
          reasoning_effort: "low",
        },
      },
    }),
  })
  const started = await manager.start(baseSpec({ execution_mode: mode }))
  if (started.kind !== "started") throw new Error(`Unexpected start: ${started.kind}`)
  const fallbackObserved = Promise.withResolvers<void>()
  const unsubscribeFallback = manager.subscribeChild(started.task_id, (event) => {
    if (event.type === "retry_fallback_applied") fallbackObserved.resolve()
  })
  try {
    // when: the real SDK admits the fallback while its response is still blocked.
    const prematureEnd = manager.waitFor(started.task_id).then((record) => {
      throw new Error(`Child ended before the expected request: ${record.status}: ${record.error_message}`)
    })
    const completePrimary = await Promise.race([primaryResponse.promise, prematureEnd])
    completePrimary()
    const completeFallback = await Promise.race([fallbackResponse.promise, prematureEnd])
    await Promise.race([fallbackObserved.promise, prematureEnd])
    expect(harness.session.thinkingLevel).toBe("high")
    const admittedIndex = harness.events.findIndex((event) => event.type === "model_changed" && event.source === "fallback")
    expect(admittedIndex).toBeGreaterThanOrEqual(0)
    expect(admittedIndex).toBeLessThan(harness.events.findIndex((event) => event.type === "retry_fallback_applied"))
    expect(harness.events[admittedIndex]).toMatchObject({ thinkingLevel: "high" })
    expect(harness.events).toContainEqual({
      type: "retry_fallback_applied",
      from: "runtime-fallback-test/dead-primary",
      to: "runtime-fallback-test/healthy-fallback",
      chainKey: "runtime-fallback-test/dead-primary",
      reason: "billing",
    })

    // then: no config lookup can supply high; the manager only has the old low route.
    const running = manager.get(started.task_id)
    completeFallback()
    const finished = await manager.waitFor(started.task_id)
    expect(running).toMatchObject({
      status: "running",
      resolved_model: { model_id: "healthy-fallback", reasoning_effort: "high" },
    })
    expect(finished).toMatchObject({
      status: "completed",
      resolved_model: { model_id: "healthy-fallback", reasoning_effort: "high" },
    })
  } finally {
    manager.forget(started.task_id)
    unsubscribeFallback()
    unsubscribeWire()
    await rpc.dispose()
    child.stdin.end()
    await closed
    harness.dispose()
  }
}, 10_000)
