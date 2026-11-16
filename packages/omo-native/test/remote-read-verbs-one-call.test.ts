// Architecture contract G3 (design one-remote-module v8-core r2, omo#13414): each `omo remote` read verb makes exactly
// ONE member call on the person client, and its --json output is that call's value serialized.
import { describe, expect, test } from "bun:test"

import type { RemoteClient } from "../../omo-senpi/src/components/remote/client"
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
