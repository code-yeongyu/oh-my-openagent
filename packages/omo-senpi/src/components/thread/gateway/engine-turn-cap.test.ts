// omo#14941 (senpi#7138, senpi#7444): an engine whose engine-turn cap stops the turn a delivery would start answers
// admission `held` with the cap. The sender is told the delivery is parked behind that cap, by name, on every surface
// (the tool result, its rendered line, the SDK, a replay), and never `started`. A real start still says started, and a
// `held` under a person's hold still says hold.
import { afterEach, describe, expect, test } from "bun:test"

import type { Theme, ThemeColor } from "@code-yeongyu/senpi"

import { awaitPromptStart } from "../control/prompt-start"
import { createThreadSdk } from "../sdk"
import { createThreadTools, type ThreadHost } from "../tools"
import { renderThreadResult } from "../tools/render"
import { toSessionControlDrainResult } from "./adapter"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

const CAP = { reason: "cap-per-resume-window", count: 8 } as const
const PARKED = { kind: "queued", queue_position: 1, waiting_on: { kind: "engine_turn_cap", ...CAP } }
const PLAIN = { fg: (_color: ThemeColor, text: string) => text, bold: (text: string) => text } as unknown as Theme

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function fixture() {
  const h = (harness = createGatewayHarness())
  const receiver = h.session("receiver")
  const unused = async (): Promise<never> => {
    throw new Error("unused host operation")
  }
  const host: ThreadHost = {
    socket: "fixture",
    listSessions: async () => [
      { sessionId: receiver.id, durableSessionId: receiver.id, cwd: receiver.cwd, name: "receiver" },
    ],
    gateway: {
      wake: async (_endpoint, ids) =>
        toSessionControlDrainResult(await receiver.drain.drain({ reason: "command", delivery_ids: ids })),
    },
    openSession: unused,
    getMessages: unused,
    getState: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
  }
  const tools = createThreadTools({
    host,
    env: { HOME: h.agentDir },
    stateDirectory: h.agentDir,
    store: h.store(),
    callerSessionId: () => "sender",
    callerWorkspaceRoot: () => h.agentDir,
  })
  const tool = tools.find((candidate) => candidate.name === "thread_send")
  if (tool === undefined) throw new Error("missing thread_send")
  const send = async (message: string, idempotency_key?: string) =>
    await Reflect.apply(tool.execute, tool, [
      `call-${message}`,
      { thread: "receiver", message, ...(idempotency_key === undefined ? {} : { idempotency_key }) },
      undefined,
      undefined,
      undefined,
    ])
  const sdk = () =>
    createThreadSdk({ agentDir: h.agentDir, cwd: h.agentDir, env: {}, uid: 42, user: "tester", host, store: h.store() })
  return { h, receiver, send, sdk }
}

function rendered(output: { readonly details: { readonly result: unknown } }): string[] {
  return renderThreadResult("thread_send")(output as never, { expanded: false, isPartial: false }, PLAIN, {
    args: { thread: "receiver", message: "hi" },
    isError: false,
  } as never)
    .render(200)
    .map((line) => line.trimEnd())
}

describe("a delivery the engine-turn cap holds (senpi#7138)", () => {
  test("#given an idle receiver at its engine-turn cap #when thread_send delivers #then the result is queued waiting on the cap by name, no turn starts, and the line says why", async () => {
    const { receiver, send } = fixture()
    receiver.runtime.engineTurnCap = CAP
    const output = await send("are you there")
    expect(output.details.result).toMatchObject({ kind: "ok", delivery: PARKED, effective_mode: "follow_up" })
    expect(output.details.result.delivery.kind).not.toBe("started")
    expect(receiver.runtime.enqueueCalls).toEqual([])
    expect(rendered(output)[0]).toBe(
      "-> receiver  queued #1: automatic turns paused (cap-per-resume-window at 8); runs when a person sends a message or resumes the thread",
    )
  })

  test("#given an idle receiver at its engine-turn cap #when the SDK sends, then repeats under the same key #then both answers name the cap and the repeat is the first delivery's state", async () => {
    const { receiver, sdk } = fixture()
    receiver.runtime.engineTurnCap = CAP
    const client = sdk()
    try {
      const first = await client.send({ thread: "receiver", text: "hello", idempotency_key: "k-cap" })
      expect(first).toMatchObject({ kind: "ok", delivery: PARKED })
      const repeat = await client.send({ thread: "receiver", text: "hello", idempotency_key: "k-cap" })
      expect(repeat).toMatchObject({ kind: "ok", deduplicated: true, delivery: PARKED })
    } finally {
      await client.dispose()
    }
  })

  test("#given a first prompt the cap holds #when a create waits for it to start #then it answers queued waiting on the cap, never started", async () => {
    const { h, receiver, send } = fixture()
    receiver.runtime.engineTurnCap = CAP
    const output = await send("first prompt")
    expect(await awaitPromptStart(h.store(), output.details.result.delivery_id, 0)).toEqual({
      kind: "queued",
      waiting_on: { kind: "engine_turn_cap", ...CAP },
    })
  })

  test("#given an idle receiver under no cap #when thread_send delivers #then it still starts a turn", async () => {
    const { receiver, send } = fixture()
    const output = await send("start please")
    expect(output.details.result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
    expect(receiver.runtime.enqueueCalls).toEqual([expect.objectContaining({ lane: "start" })])
  })

  test("#given an idle receiver under a person's Stop #when thread_send delivers #then it still waits on the hold, not the cap", async () => {
    const { receiver, send } = fixture()
    receiver.runtime.sessionHolds = ["session_hold"]
    const output = await send("held")
    expect(output.details.result).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued", waiting_on: { kind: "hold" } },
      effective_mode: "follow_up",
    })
  })
})
