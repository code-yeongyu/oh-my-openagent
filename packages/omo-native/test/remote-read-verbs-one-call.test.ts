// Architecture contract G3 (design one-remote-module v8-core r2, omo#13414): each `omo remote` read verb makes exactly
// ONE member call on the person client, and its --json output is that call's value serialized.
import { describe, expect, test } from "bun:test"

import type { RemoteClient } from "../../omo-senpi/src/components/remote/index"
import { REMOTE_EXIT } from "../remote-cli"
import { privateDir, run, useRemoteCliCleanup } from "./remote-cli-harness"

useRemoteCliCleanup()

const VALUES = {
  "service.status": {
    state: "connected",
    enabled: true,
    device: { id: "dev-self", name: "This Mac" },
    service_version: "9.9.9",
  },
  "devices.list": [
    {
      id: "dev-self",
      name: "This Mac",
      kind: "desktop",
      platform: "darwin",
      online: true,
      last_seen_ms: null,
      self: true,
      caps: { attach: true, machine: false, control: true },
    },
  ],
  "sessions.list": { revision: 7, rows: [], unanswered: [] },
  "service.setEnabled": { enabled: false },
  "service.control": { attached: true, changedAt: "" },
  "service.setControl": { attached: false, changedAt: "" },
  "service.wake": { enabled: true, stored: null, overridden: false },
  "service.setWake": { enabled: false, stored: false, overridden: false },
} as const

type Member = keyof typeof VALUES

// A client whose every member records its name and answers the canned value; `close` is lifecycle, not a call.
function spyClient(calls: string[]): () => RemoteClient {
  const group = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, member: string) => async () => {
          const key = `${name}.${member}`
          calls.push(key)
          return { kind: "ok", value: VALUES[key as Member] }
        },
      },
    )
  const client = { service: group("service"), devices: group("devices"), sessions: group("sessions"), close: () => {} }
  return () => client as unknown as RemoteClient
}

describe("omo remote read verbs (G3: one person-client call per verb)", () => {
  test.each<[readonly string[], Member]>([
    [["status"], "service.status"],
    [["devices"], "devices.list"],
    [["sessions", "--device", "dev-self"], "sessions.list"],
    [["disable"], "service.setEnabled"],
    [["control"], "service.control"],
    [["control", "off"], "service.setControl"],
    [["wake"], "service.wake"],
    [["wake", "off"], "service.setWake"],
  ])("#given %p --json #when it runs #then it calls %s once and prints its value", async (args, member) => {
    const calls: string[] = []
    const { code, out } = await run([...args, "--json"], privateDir(), undefined, undefined, undefined, {
      client: spyClient(calls),
    })
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(calls).toEqual([member])
    expect(JSON.parse(out.join(""))).toEqual(VALUES[member])
  })
})

// A client whose status member answers one typed failure, as the client does for a connect or a body failure.
const failingClient = (failure: Record<string, unknown>) => () =>
  ({ service: { status: async () => ({ kind: "error", ...failure }) }, close: () => {} }) as unknown as RemoteClient

describe("omo remote read verbs: failures of the person client", () => {
  const fail = (failure: Record<string, unknown>) =>
    run(["status"], privateDir(), undefined, undefined, undefined, { client: failingClient(failure) })

  test("#given the connection itself failed #when status runs #then it says the service is not running, exit 3", async () => {
    const { code, err } = await fail({
      code: "host_unavailable",
      message: "The device service did not answer: connect ECONNREFUSED.",
      next_action: "Call service.status.",
      details: { phase: "connect" },
    })
    expect([code, err]).toEqual([REMOTE_EXIT.unavailable, ["The OmO device service is not running on this device."]])
  })

  test("#given a failure inside the member after a good connect #when status runs #then its own message and next step are printed", async () => {
    const { code, err } = await fail({
      code: "host_unavailable",
      message: "The device service did not answer: boom.",
      next_action: "Call service.status to see why, then retry.",
    })
    expect(code).toBe(REMOTE_EXIT.unavailable)
    expect(err).toEqual([
      "omo remote: The device service did not answer: boom.",
      "Call omo remote status to see why, then retry.",
    ])
  })

  test.each([
    ["timeout", 124],
    ["cancelled", 130],
    ["device_offline", 3],
    ["not_found", 1],
  ])(
    "#given a %s failure #when status runs #then it exits with the remote module's exit code %d",
    async (code, exit) => {
      const result = await fail({ code, message: `${code} happened`, next_action: "Retry the call." })
      expect(result.code).toBe(exit)
    },
  )
})
