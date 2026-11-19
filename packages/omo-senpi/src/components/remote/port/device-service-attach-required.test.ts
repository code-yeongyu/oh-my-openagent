import { describe, expect, test } from "bun:test"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import { closingPorts } from "../../thread/remote/testing/closing-ports"

// #14358: the other device refuses a command engine_capability_missing with receipt.reason attach_required when it lists
// the session on a route that takes no delegated connections and counts no attach of this device to it. Nothing ran, so
// the port drops its pooled attach, attaches again and sends the record once more; a second such refusal is the answer.
const sessionsPort = closingPorts()

const REFUSED = {
  outcome: {
    state: "engine_refused",
    reason: "engine_capability_missing",
    receipt: { reason: "attach_required", endpoint_kind: "tui" },
    retryable: false,
  },
}
const APPLIED = {
  outcome: { state: "engine_applied", retryable: false },
  response: { type: "response", command: "get_state", success: true, data: { isStreaming: false } },
}
const GET_STATE = { type: "get_state", sessionId: "s1" }

/** b's service: each attach answers its commands from `answers` (one list per attach, in attach order). */
function service(answers: ReadonlyArray<ReadonlyArray<object>>, direct?: object) {
  const attaches: Array<{ detached: boolean; commands: number }> = []
  const conn = {
    attach: async (_device: string, key: string) => {
      const index = attaches.length
      const seen = { detached: false, commands: 0 }
      attaches.push(seen)
      return {
        key,
        detached: new Promise(() => {}),
        detach: async () => {
          seen.detached = true
        },
        command: async () => {
          const answer = answers[index]?.[seen.commands] ?? APPLIED
          seen.commands += 1
          return answer
        },
      }
    },
    sessionCommand: async () => direct ?? APPLIED,
    closed: new Promise(() => {}),
    close: () => undefined,
  } as unknown as DeviceService
  const port = sessionsPort({ version: "0.0.0-test", connect: async () => ({ conn, owned: true }) })
  return { port, attaches }
}

describe("device-service port: a command refused attach_required is sent again once on a fresh attach (#14358)", () => {
  test("#given b refuses the first attach's command attach_required #when a command is sent #then the port attaches again, sends it once more and answers b's reply, and the stale attach is detached", async () => {
    const { port, attaches } = service([[REFUSED], [APPLIED]])
    const sent = await port.sessionCommand("b", "s1", GET_STATE)
    expect(sent).toMatchObject({ kind: "ok", response: { success: true } })
    expect(attaches.map((a) => a.commands)).toEqual([1, 1])
    expect(attaches[0]?.detached).toBe(true)
  })

  test("#given b refuses attach_required on the fresh attach too #when a command is sent #then that refusal is the answer, after exactly two attaches", async () => {
    const { port, attaches } = service([[REFUSED], [REFUSED]])
    expect(await port.sessionCommand("b", "s1", GET_STATE)).toEqual({
      kind: "refused",
      reason: "engine_capability_missing",
      detail: "attach_required",
    })
    expect(attaches).toHaveLength(2)
  })

  test("#given b refuses an attach-less (direct) command attach_required #when it is sent #then it goes the attach way and answers b's reply", async () => {
    const { port, attaches } = service([[APPLIED]], REFUSED)
    expect(await port.sessionCommand("b", "s1", GET_STATE, { direct: true })).toMatchObject({ kind: "ok" })
    expect(attaches).toHaveLength(1)
  })
})
