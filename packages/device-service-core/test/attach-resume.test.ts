import { describe, expect, test } from "bun:test"

import { connectDeviceService, LocalApiError } from "../src/index.ts"
import type { LocalApiClient } from "../src/local-api/client.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"

// relay daemon #774 / #782: session.attach takes `seqs: true` and `resume {attach_id, seq}`; a service before it answers
// either field invalid_request. `supports` picks which service answers; every session.attach's fields are kept as sent.
function service(supports: boolean, refuse?: string) {
  const sent: Array<Readonly<Record<string, unknown>>> = []
  const client: LocalApiClient = {
    welcome: { type: "welcome", v: 1, service_version: "1.4.0", owner: "service", server_proof: "p", server_nonce: "n", capabilities: [], state: defaultWorld().status },
    request: (async (type: string, params: Readonly<Record<string, unknown>>) => {
      if (type !== "session.attach") throw new Error(`unexpected request ${type}`)
      sent.push(params)
      if (!supports && (params["seqs"] !== undefined || params["resume"] !== undefined)) throw new LocalApiError("invalid_request", "request has an unknown field")
      if (refuse !== undefined && params["resume"] !== undefined) throw new LocalApiError("invalid_request", refuse)
      return { attach: `a${sent.length}` }
    }) as LocalApiClient["request"],
    onEvent: () => () => {},
    command: async () => "c",
    endpointCommand: async () => "c",
    list: async () => ({ query_id: "q", revision: 0, rows: [], incomplete: [], devices: {} }),
    read: async () => ({ entries: [], next_before: null }),
    oversizedLines: () => 0,
    close: () => {},
    closed: new Promise<void>(() => {}),
  }
  return { sent, connect: () => connectDeviceService({ version: "5.1.52", stateDir: "/unused", connect: async () => client }) }
}

describe("attach record seqs and resume (relay daemon #774)", () => {
  test("#given a service with #774 #when an attach asks for seqs, then one resumes #then each request carries its field and each attach reports what the service took", async () => {
    const svc = service(true)
    const connected = await svc.connect()
    const plain = await connected.attach("dev-peer-1", "s1", { seqs: true })
    const resumed = await connected.attach("dev-peer-1", "s1", { resume: { attach_id: 3, seq: 5 } })
    expect([svc.sent, [plain.seqs, plain.resume], [resumed.seqs, resumed.resume]]).toEqual([
      [{ device: "dev-peer-1", session_id: "s1", seqs: true }, { device: "dev-peer-1", session_id: "s1", resume: { attach_id: 3, seq: 5 } }],
      [true, undefined],
      [true, { attach_id: 3, seq: 5 }],
    ])
  })

  test("#given a service before #774 #when it refuses the fields invalid_request #then the attach is retried plain, reports neither, and the connection asks plain from then on", async () => {
    const svc = service(false)
    const connected = await svc.connect()
    const first = await connected.attach("dev-peer-1", "s1", { resume: { attach_id: 3, seq: 5 } })
    const second = await connected.attach("dev-peer-1", "s1", { seqs: true })
    expect([svc.sent, [first.handle, first.seqs, first.resume], [second.handle, second.seqs]]).toEqual([
      [{ device: "dev-peer-1", session_id: "s1", resume: { attach_id: 3, seq: 5 } }, { device: "dev-peer-1", session_id: "s1" }, { device: "dev-peer-1", session_id: "s1" }],
      ["a2", false, undefined],
      ["a3", false],
    ])
  })

  // Review of #12771 at 37b5af3936 (LOW): every invalid_request was read as a service before #774, so a #774 service
  // refusing a malformed resume (a client bug) was hidden behind a plain attach. Only the unknown-field refusal is.
  test("#given a service with #774 #when it refuses a malformed resume invalid_request #then the attach fails with that refusal and is not retried plain", async () => {
    const svc = service(true, "resume.seq")
    const connected = await svc.connect()
    const failed = await connected.attach("dev-peer-1", "s1", { resume: { attach_id: 3, seq: -1 } }).then(() => undefined, (error: unknown) => error)
    expect([failed instanceof LocalApiError ? [failed.code, failed.reason] : failed, svc.sent.length]).toEqual([["invalid_request", "resume.seq"], 1])
  })
})
