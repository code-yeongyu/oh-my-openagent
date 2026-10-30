import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import type { AgentSessionEvent, RpcResponse } from "@code-yeongyu/senpi"
import { describe, expect, test } from "bun:test"

import { adaptInProcessHandle, adaptRpcHandle } from "../manager/child-handle"
import { nativeChildPausePort } from "../pause/native-child-pause"
import type { RunPauseOwner } from "../pause/ports"
import { createChildExtensionEvents } from "./child-extension-events"
import { createChildHandle, type ChildSession, type ChildSessionListener } from "./in-process/child-handle"
import { createRpcChildHandle } from "./rpc/handle"
import type { RpcProtocolClient } from "./rpc/protocol-client"
import { createManualSettlementScheduler } from "./rpc/turn-settlement.test-support"
import type { TaskParentCommand } from "./task-parent-control"

const owner: RunPauseOwner = { parentSessionId: "parent", parentPauseSeq: 2, runRef: { kind: "dag", id: "run" } }
const guidance = { inputId: "guide-1", revision: 1, text: "Use staging" }
const resume = { ...owner, resumeId: "resume-1", childSeqCutoff: 4 }

function fakeSession(runHold: boolean) {
  const listeners = new Set<ChildSessionListener>()
  const held: unknown[] = []
  const prompt = Promise.withResolvers<void>()
  const emit = (event: { readonly type: string; readonly message?: unknown }) => {
    for (const listener of [...listeners]) listener(event)
  }
  const base: ChildSession = {
    sessionId: "child-session",
    prompt: () => prompt.promise,
    steer: async () => "delivered" as never,
    followUp: async () => "delivered" as never,
    abort: async () => undefined,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText: () => undefined,
    dispose: () => undefined,
  }
  const session: ChildSession = !runHold ? base : {
    ...base,
    pauseView: { records: [{ kind: "inherited_hold", parentSessionId: "parent" }] },
    pauseForRun: async () => ({ childSeq: 4 }),
    resumeForRun: async () => {
      emit({ type: "agent_start" })
      return { released: true, otherHoldLive: false, turnId: "7" }
    },
    holdInput: (input) => {
      held.push(input)
      return { kind: "held", entryId: "entry-1", duplicate: false }
    },
  }
  return { session, emit, held, endPrompt: () => prompt.resolve() }
}

const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" })
const textTurnEnd = (text: string) => [
  { type: "message_end", message: assistant(text) },
  { type: "agent_end", willRetry: false, messages: [assistant(text)] },
]

describe("in-process native run pause", () => {
  test("#given a child engine without run hold #when pausing through the production port #then refuse as native_pause_unavailable", async () => {
    const { session } = fakeSession(false)
    const handle = adaptInProcessHandle(createChildHandle({ taskId: "st_1", session, promptText: "go" }))
    expect(handle.runPause).toBeUndefined()
    await expect(nativeChildPausePort.pauseForRun(handle, owner)).rejects.toMatchObject({ code: "native_pause_unavailable" })
    await expect(nativeChildPausePort.holdInput(handle, guidance, owner)).rejects.toMatchObject({ code: "native_pause_unavailable" })
  })

  test("#given a run-hold engine #when guidance names another parent #then refuse wrong_parent without holding it", async () => {
    const fake = fakeSession(true)
    const handle = adaptInProcessHandle(createChildHandle({ taskId: "st_1", session: fake.session, promptText: "go" }))
    await expect(nativeChildPausePort.holdInput(handle, guidance, { parentSessionId: "other" })).rejects.toMatchObject({ code: "wrong_parent" })
    expect(fake.held).toEqual([])
    expect(await nativeChildPausePort.holdInput(handle, guidance, owner)).toEqual({ kind: "held", entryId: "entry-1", duplicate: false })
    expect(fake.held).toEqual([guidance])
  })

  test("#given a paused child #when the engine starts the resumed turn #then the outcome is that turn's own result", async () => {
    const fake = fakeSession(true)
    const handle = adaptInProcessHandle(createChildHandle({ taskId: "st_1", session: fake.session, promptText: "go" }))
    for (const event of textTurnEnd("first")) fake.emit(event)
    fake.endPrompt()
    expect(await handle.waitForOutcome()).toMatchObject({ status: "completed", finalResponse: "first" })
    expect(await nativeChildPausePort.pauseForRun(handle, owner)).toEqual({ childSeq: 4 })
    const turn = await nativeChildPausePort.resumeTurn(handle, resume)
    if (!("turnId" in turn)) throw new Error("expected a resumed turn")
    expect(turn.turnId).toBe("7")
    for (const event of textTurnEnd("resumed")) fake.emit(event)
    expect(await turn.outcome).toMatchObject({ status: "completed", finalResponse: "resumed" })
  })
})

function rpcHarness(answer: (command: TaskParentCommand) => RpcResponse | undefined) {
  const child = Object.assign(new EventEmitter(), { pid: 4242 }) as unknown as ChildProcess
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const sent: TaskParentCommand[] = []
  const emit = (record: unknown) => {
    for (const listener of [...listeners]) listener(record as AgentSessionEvent)
  }
  const client = {
    extensionEvents: createChildExtensionEvents(),
    stderrTail: "",
    send: async () => ({ success: true, command: "get_state", data: { sessionId: "s-1", isStreaming: false, steering: [], followUp: [], pendingMessageCount: 0 } }) as unknown as RpcResponse,
    sendTaskParent: async (command: TaskParentCommand) => {
      sent.push(command)
      if (command.type === "set_client_info") return { success: true } as unknown as RpcResponse
      if (command.type === "resume_for_run") emit({ type: "agent_start" })
      return answer(command) ?? ({ success: false, error: `Unknown command: ${command.type}` } as unknown as RpcResponse)
    },
    onEvent: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    detach: () => listeners.clear(),
  } as unknown as RpcProtocolClient
  const scheduler = createManualSettlementScheduler()
  const raw = createRpcChildHandle({ client, child, taskId: "st_2", heartbeatIntervalMs: 60_000, now: () => 1, settlementScheduler: scheduler.scheduler })
  // A non-retrying agent_end is held until agent_idle settles it; the manual scheduler keeps any
  // error confirmation off the wall clock.
  const settle = (text: string) => {
    for (const record of [...textTurnEnd(text), { type: "agent_idle" }]) emit(record)
  }
  return { handle: adaptRpcHandle(raw), emit, sent, settle }
}

describe("RPC native run pause", () => {
  test("#given a child engine that predates run hold #when pausing #then refuse as native_pause_unavailable", async () => {
    const h = rpcHarness(() => undefined)
    await expect(nativeChildPausePort.pauseForRun(h.handle, owner)).rejects.toMatchObject({ code: "native_pause_unavailable" })
    expect(h.sent.map(command => command.type)).toEqual(["set_client_info", "pause_for_run"])
  })

  test("#given a run-hold engine #when Resume starts a turn #then it is claimed, never announced as self-resumed, and settles once", async () => {
    const h = rpcHarness(command => command.type === "pause_for_run"
      ? { success: true, data: { held: true, childSeq: 4 } } as unknown as RpcResponse
      : command.type === "resume_for_run"
        ? { success: true, data: { released: true, otherHoldLive: false, turnId: "9" } } as unknown as RpcResponse
        : undefined)
    let selfResumed = 0
    h.handle.onSelfResumed?.(() => { selfResumed += 1 })
    h.emit({ type: "agent_start" })
    h.settle("first")
    expect(await h.handle.waitForOutcome()).toMatchObject({ status: "completed", finalResponse: "first" })
    expect(await nativeChildPausePort.pauseForRun(h.handle, owner)).toEqual({ childSeq: 4 })
    const turn = await nativeChildPausePort.resumeTurn(h.handle, resume)
    if (!("turnId" in turn)) throw new Error("expected a resumed turn")
    h.settle("resumed")
    expect(await turn.outcome).toMatchObject({ status: "completed", finalResponse: "resumed" })
    expect(selfResumed).toBe(0)
    h.emit({ type: "agent_start" })
    expect(selfResumed).toBe(1)
  })
})
