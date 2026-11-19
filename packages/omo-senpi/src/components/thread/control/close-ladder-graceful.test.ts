import { describe, expect, test } from "bun:test"
import { withCallDeadline } from "../../call-budget/call-deadline"
import type { JsonObject } from "../remote/ports"
import { closeLadder, type LadderSend } from "./close-ladder"
import { controlRefusalOf } from "./port"

// omo#14313: thread_close { graceful: true } is one senpi `unload_session { graceful, waitMs }`, never an interrupting
// unload, answered typed whether the session closed, its turn outlived the wait, or its engine predates the record.

type Engine = { readonly capabilities: readonly string[]; readonly unload: (rpc: JsonObject) => JsonObject }

function engine(script: Engine): { readonly send: LadderSend; readonly sent: JsonObject[]; readonly waits: number[] } {
  const sent: JsonObject[] = []
  const waits: number[] = []
  const send: LadderSend = async (rpc, options) => {
    sent.push(rpc)
    if (options?.waitMs !== undefined) waits.push(options.waitMs)
    if (rpc["type"] === "get_protocol_info") return { kind: "ok", data: { capabilities: [...script.capabilities] } }
    if (rpc["type"] === "unload_session") return { kind: "ok", data: script.unload(rpc) }
    throw new Error(`unexpected record ${String(rpc["type"])}`)
  }
  return { send, sent, waits }
}

const GRACEFUL_ENGINE = ["unload_session", "unload_refuse_deliveries", "unload_graceful"]

async function refusalOf(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    return controlRefusalOf(error)
  }
  throw new Error("the close was not refused")
}

describe("closeLadder { graceful: true }", () => {
  test("#given an engine with unload_graceful #when a busy thread closes gracefully #then one graceful unload ends it and the answer carries what it waited for and handed back", async () => {
    const { send, sent, waits } = engine({
      capabilities: GRACEFUL_ENGINE,
      unload: () => ({
        outcome: "unloaded",
        sessionPath: "/s.jsonl",
        dropped: { deliveries: ["d-queued"], user_messages: ["typed while busy"] },
        graceful: { turn: 4, waited_ms: 1200, stopped: { wake_sources: ["terminal"] } },
      }),
    })
    expect(await closeLadder("s1", send, { graceful: true, wait_ms: 20_000 })).toEqual({
      outcome: "closed",
      dropped_deliveries: ["d-queued"],
      graceful: {
        turn: 4,
        waited_ms: 1200,
        stopped_wake_sources: ["terminal"],
        returned_user_messages: ["typed while busy"],
      },
    })
    const unloads = sent.filter((rpc) => rpc["type"] === "unload_session")
    expect(unloads).toEqual([
      {
        type: "unload_session",
        sessionId: "s1",
        force: true,
        children: "detach",
        effectId: expect.any(String),
        graceful: true,
        waitMs: 20_000,
      },
    ])
    expect(unloads[0]?.["interrupt"]).toBeUndefined()
    expect(waits).toEqual([20_000])
  })

  test("#given a turn that outlives the wait #when the thread closes gracefully #then it is refused turn_active, still running and open, naming the turn and the returned messages", async () => {
    const { send } = engine({
      capabilities: GRACEFUL_ENGINE,
      unload: () => ({
        outcome: "refused",
        reason: "turn_active",
        timed_out: true,
        open: true,
        admission: "reopened",
        turn: 7,
        waited_ms: 5000,
        dropped: { deliveries: ["d-1"], user_messages: [] },
      }),
    })
    const refusal = await refusalOf(() => closeLadder("s1", send, { graceful: true, wait_ms: 5000 }))
    expect(refusal).toMatchObject({
      code: "turn_active",
      details: { still_running: true, open: true, turn: 7, waited_ms: 5000, returned_deliveries: ["d-1"] },
    })
  })

  test("#given an engine without unload_graceful #when the thread closes gracefully #then it is refused unsupported and nothing is unloaded", async () => {
    const { send, sent } = engine({ capabilities: ["unload_session"], unload: () => ({ outcome: "unloaded" }) })
    const refusal = await refusalOf(() => closeLadder("s1", send, { graceful: true }))
    expect(refusal).toMatchObject({ code: "unsupported", details: { capability: "unload_graceful" } })
    expect(sent.map((rpc) => rpc["type"])).toEqual(["get_protocol_info"])
  })

  test("#given a terminal whose composer holds unsent text #when its thread closes gracefully #then it is refused naming the draft", async () => {
    const { send, sent } = engine({
      capabilities: GRACEFUL_ENGINE,
      unload: (rpc) =>
        rpc["graceful"] === true
          ? { outcome: "refused", reason: "composer_draft", detail: "unsent draft" }
          : { outcome: "refused", reason: "unsupported", detail: "not graceful" },
    })
    expect(await refusalOf(() => closeLadder("s1", send, { graceful: true }))).toMatchObject({
      code: "unsupported",
      details: { reason: "composer_draft" },
    })
    expect(sent.filter((rpc) => rpc["type"] === "unload_session").map((rpc) => rpc["graceful"])).toEqual([true])
  })

  test("#given a tool call with 25 s of budget left #when it asks for a 10 minute graceful wait #then the engine is given what the call can still answer within", async () => {
    const { send, sent } = engine({ capabilities: GRACEFUL_ENGINE, unload: () => ({ outcome: "unloaded" }) })
    const now = Date.now()
    await withCallDeadline(now + 25_000, () => closeLadder("s1", send, { graceful: true, wait_ms: 600_000 }))
    const waitMs = sent.find((rpc) => rpc["type"] === "unload_session")?.["waitMs"]
    expect(typeof waitMs).toBe("number")
    expect(Number(waitMs)).toBeGreaterThan(0)
    expect(Number(waitMs)).toBeLessThanOrEqual(15_000)
  })
})
