import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk"

// #15014: the root's input schemas are closed (contract/call-spec.ts), but no shipped surface validates against them at
// run time yet. The thread facade, the root's threads members and the thread tools already refuse an unknown top-level
// key in the thread core (thread/contracts/parse.ts unknownKeys / parseThreadParams; pinned by thread/sdk.test.ts).
// These calls instead ignore it today. Pinned here so the difference stays visible until it is decided: an unknown key
// must not change their answer.
describe("shipped root calls that ignore an unknown key today (recorded difference, #15014)", () => {
  const calls = [
    ["config.status", (root: ReturnType<typeof createOmoSdk>, input?: object) => root.config.status(input as never)],
    ["account.whoami", (root: ReturnType<typeof createOmoSdk>, input?: object) => root.account.whoami(input as never)],
  ] as const

  for (const [name, call] of calls)
    test(`#given ${name} #when the input carries a key its schema does not name #then it answers as without it`, async () => {
      const home = mkdtempSync(join(tmpdir(), "omo-unknown-key-"))
      const env = { HOME: home, OMO_SERVICE_API_URL: "https://accounts.example.test" }
      const root = createOmoSdk({ env, cwd: home, ports: { desktopLaunch: () => false } })
      try {
        const without = await call(root, {})
        const withUnknown = await call(root, { unknown_key_probe: 1 })
        expect(withUnknown).toEqual(without)
      } finally {
        await root.dispose()
        rmSync(home, { recursive: true, force: true })
      }
    })
})
