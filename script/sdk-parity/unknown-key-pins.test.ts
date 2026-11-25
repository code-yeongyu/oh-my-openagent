import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk"

// #15014: the root's input schemas are closed (contract/call-spec.ts). The thread facade, the root's threads members and
// the thread tools already refuse an unknown top-level key in the thread core (thread/contracts/parse.ts unknownKeys /
// parseThreadParams; pinned by thread/sdk.test.ts). These seven shipped calls ignore it instead, and keep doing so until
// #15016 decides otherwise: an unknown key must not change their answer. Each runs through the real root over fake ports
// (no network, no sign-in process, no device service), so the answer compared is the call's own.
type Call = (input?: object) => Promise<unknown>
const SHIPPED_IGNORING: readonly (readonly [string, object])[] = [
  ["config.status", {}],
  ["account.whoami", {}],
  ["account.signIn", {}],
  ["devices.list", {}],
  ["devices.rename", { id: "device-1", name: "laptop" }],
  ["deviceService.status", {}],
  ["daemon.warm", {}],
]

const member = (root: object, key: string): Call =>
  key.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), root) as Call

describe("shipped root calls that ignore an unknown key today (recorded difference, #15016)", () => {
  for (const [key, input] of SHIPPED_IGNORING)
    test(`#given ${key} #when the input carries a key its schema does not name #then it answers as without it`, async () => {
      const home = mkdtempSync(join(tmpdir(), "omo-unknown-key-"))
      const root = createOmoSdk({
        env: { HOME: home, OMO_SERVICE_API_URL: "http://127.0.0.1:9" },
        cwd: home,
        agentDir: join(home, "agent"),
        ports: {
          desktopLaunch: () => false,
          deviceServiceStatus: async () => ({ kind: "no_answer" }) as never,
          signInProcess: (async () => ({ code: 1 })) as never,
        },
      })
      try {
        const call = member(root, key)
        const without = await call(input)
        expect(await call({ ...input, unknown_key_probe: 1 })).toEqual(without)
      } finally {
        await root.dispose()
        rmSync(home, { recursive: true, force: true })
      }
    })
})
