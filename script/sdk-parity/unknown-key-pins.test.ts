import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk"
import type { OmoSdkPorts } from "../../packages/omo-senpi/src/components/omo-sdk/options"
import { loadScenarioTable } from "./scenario-table"

// #15014: the root's input schemas are closed (contract/call-spec.ts). These seven shipped calls have always ignored an
// unknown top-level key and keep doing so (root/assemble.ts UNKNOWN_KEYS_DROPPED) until #15016 decides otherwise. Each
// runs through the real root over local fake ports only: a signed-out credential store, a session port that records every
// request, a device service that does not answer, a sign-in process that exits 1. So each answer is the call's own known
// answer, never an incidental refusal of the environment, and no call reaches a live service.
type Call = (input?: object) => Promise<unknown>
const SHIPPED_IGNORING: readonly (readonly [string, object, unknown])[] = [
  ["config.status", {}, { kind: "ok" }],
  ["account.whoami", {}, { kind: "error", error: { code: "signed_out" } }],
  ["account.signIn", {}, { kind: "error", error: { code: "internal_error" } }],
  ["devices.list", {}, { kind: "error", error: { code: "signed_out" } }],
  ["devices.rename", { id: "device-1", name: "laptop" }, { kind: "error", error: { code: "signed_out" } }],
  ["deviceService.status", {}, { kind: "error", error: { code: "device_service_unavailable" } }],
  ["daemon.warm", {}, { kind: "ok", value: { kind: "refused", code: "no_answer" } }],
]

const member = (root: object, key: string): Call =>
  key.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), root) as Call

describe("shipped root calls that ignore an unknown key today (recorded difference, #15016)", () => {
  for (const [key, input, known] of SHIPPED_IGNORING)
    test(`#given ${key} #when the input carries a key its schema does not name #then it answers as without it`, async () => {
      const home = mkdtempSync(join(tmpdir(), "omo-unknown-key-"))
      const requests: string[] = []
      const ports: OmoSdkPorts = {
        desktopLaunch: () => false,
        credentialStore: { read: async () => null },
        session: {
          accessToken: async () => "token",
          request: async (path) => {
            requests.push(path)
            throw new Error("no service in this test")
          },
        },
        deviceServiceStatus: async () => ({ kind: "no_answer" }) as never,
        signInProcess: (async () => ({ code: 1 })) as never,
      }
      const root = createOmoSdk({
        env: { HOME: home, OMO_SERVICE_API_URL: "http://127.0.0.1:9" },
        cwd: home,
        agentDir: join(home, "agent"),
        ports,
      })
      try {
        const call = member(root, key)
        const without = await call(input)
        expect(without).toMatchObject(known as object)
        expect(await call({ ...input, unknown_key_probe: 1 })).toEqual(without)
        expect(requests).toEqual([])
      } finally {
        await root.dispose()
        rmSync(home, { recursive: true, force: true })
      }
    })
})

describe("the scenario table agrees with the recorded difference", () => {
  test("#given the seven calls that ignore an unknown key #then no scenario claims one of them refuses it", () => {
    const ignoring = new Set(SHIPPED_IGNORING.map(([key]) => key))
    const claims = loadScenarioTable()
      .flatMap((file) => file.scenarios)
      .filter((scenario) => ignoring.has(scenario.row) && "unknown_key_probe" in scenario.input)
      .map((scenario) => scenario.id)
    expect(claims).toEqual([])
  })
})
