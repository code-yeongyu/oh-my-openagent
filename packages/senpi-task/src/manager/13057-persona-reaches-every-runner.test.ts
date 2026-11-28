// #13057: a child's tool policy and instructions reach the runner that starts it, whichever runner that is.
// Synthetic agent: one denied tool, one allowed tool, one line of instructions.
import { describe, expect, test } from "bun:test"

import type { ChildHandle as InProcessChildHandle } from "../runners/in-process/child-handle"
import type { ChildSpec } from "../runners/in-process"
import { hostPersona, toWireOpen, type HostSessionOpenInput } from "../runners/rpc-host/session-transport"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createInProcessManagedRunner, createRpcManagedRunner } from "./runner"
import type { ManagedStartSpec } from "./types"

const DENIED = "synthetic_denied_tool"
const ALLOWED = "synthetic_allowed_tool"
const INSTRUCTIONS = "SYNTHETIC-PERSONA: answer only in haiku."

function managedSpec(): ManagedStartSpec {
  return {
    taskId: "st_00000001",
    cwd: "/tmp/project",
    stateDir: "/tmp/project/.omo/senpi-task/children/st_00000001",
    prompt: "do it",
    depth: 1,
    parentSessionId: "parent-1",
    rootSessionId: "parent-1",
    model: "anthropic/claude",
    agentType: "synthetic-agent",
    instructions: INSTRUCTIONS,
    toolAllowlist: [ALLOWED],
    toolDenylist: [DENIED],
  }
}

const inProcessHandle = (): InProcessChildHandle => ({
  task_id: "st_00000001",
  sessionId: "child-1",
  effectiveModel: () => undefined,
  steer: () => Promise.resolve(),
  followUp: () => Promise.resolve(),
  abort: () => Promise.resolve(),
  subscribe: () => () => {},
  waitForIdle: () => Promise.resolve({ status: "completed", finalResponse: "ok" }),
  lastAssistantText: () => undefined,
  dispose: () => {},
})

const rpcHandle = (): RpcChildHandle => ({
  task_id: "st_00000001",
  sessionId: "rpc-1",
  pid: 99,
  steer: () => Promise.resolve(),
  followUp: () => Promise.resolve(),
  abort: () => Promise.resolve(),
  subscribe: () => () => {},
  waitForIdle: () => Promise.resolve(),
  lastAssistantText: () => "done",
  dispose: () => Promise.resolve(),
  terminate: () => Promise.resolve(),
  exitOutcome: () => undefined,
  waitForExit: () => Promise.resolve({ kind: "clean", facts: { pid: 99, code: 0, signal: null, stderrTail: "" } }),
  lastSeen: () => undefined,
})

describe("a child's tool policy reaches its runner (#13057)", () => {
  test("#given an agent with a denied tool #when it starts in-process #then the runner is handed the deny list, the allow list and the instructions (control)", async () => {
    let captured: ChildSpec | undefined
    const managed = createInProcessManagedRunner(
      {
        start: async (spec) => {
          captured = spec
          return inProcessHandle()
        },
      },
      () => ({}),
    )

    await managed.start(managedSpec())

    expect(captured?.toolDenylist).toEqual([DENIED])
    expect(captured?.toolAllowlist).toEqual([ALLOWED])
    expect(captured?.instructions).toBe(INSTRUCTIONS)
  })

  test("#given the same agent #when it starts through the process runner (the task daemon's too) #then the runner is handed the deny list, the allow list and the instructions", async () => {
    let captured: RpcRunnerSpec | undefined
    // The one adapter in front of both the per-child process runner and the daemon host runner.
    const managed = createRpcManagedRunner({
      start: async (spec) => {
        captured = spec
        return rpcHandle()
      },
    })

    await managed.start(managedSpec())

    const handed = JSON.stringify(captured)
    expect({
      denyList: handed.includes(DENIED),
      allowList: handed.includes(ALLOWED),
      instructions: handed.includes(INSTRUCTIONS),
    }).toEqual({ denyList: true, allowList: true, instructions: true })
  })

  test("#given a daemon open request built from everything the host runner is handed #when it is put on the wire #then it can name a denied tool", () => {
    // The open request takes the persona from the same spec the host runner is handed.
    const input: HostSessionOpenInput = {
      sessionPath: "/tmp/project/session.jsonl",
      cwd: "/tmp/project",
      kind: "worker",
      context: { role: "child", task_id: "st_00000001" },
      retainOnDisconnect: true,
      autoTitle: false,
      ...hostPersona({ instructions: INSTRUCTIONS, toolAllowlist: [ALLOWED], toolDenylist: [DENIED] }),
    }

    expect(toWireOpen(input).persona).toEqual({
      appendSystemPrompt: INSTRUCTIONS,
      tools: [ALLOWED],
      excludeTools: [DENIED],
    })
  })
})
