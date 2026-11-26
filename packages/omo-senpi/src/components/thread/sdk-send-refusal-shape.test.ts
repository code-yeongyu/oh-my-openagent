import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTwoDevices, T } from "./address/testing/two-devices"
import { createGatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost } from "./tools"

// ThreadSdk.send's refusal is the shape dev answers (its error carries code, message, next_action and details, never a
// nested kind), whichever way the shared send operation refuses: the address resolver's refusal object is mapped, not
// passed through. The design lane's differential found the nested kind on this PR's head (cells "sdk send | missing" and
// "sdk send | name two threads share"; a device no one signed in takes the same refusal path with no local thread).
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const unused = async (): Promise<never> => {
  throw new Error("not used by a refused send")
}
const quietHost: ThreadHost = {
  socket: "/tmp/sdk-send-refusal.sock",
  listSessions: async () => [],
  listView: async () => ({ sessions: [], hosts: [], disk: [] }),
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
  gateway: { wake: async () => ({ admitted: [] }), releaseSession: unused },
}

function sdkOver(td: ReturnType<typeof createTwoDevices>) {
  const agentDir = mkdtempSync(join(tmpdir(), "sdk-send-refusal-"))
  const store = createGatewayStore({ agentDir })
  const sdk = createThreadSdk({
    agentDir,
    cwd: process.cwd(),
    uid: 501,
    user: "qa",
    host: quietHost,
    store,
    remote: td.remote,
  })
  cleanups.push(async () => {
    await sdk.dispose()
    rmSync(agentDir, { recursive: true, force: true })
  })
  return sdk
}

describe("a refused ThreadSdk.send answers dev's refusal shape", () => {
  test.each([
    ["a thread no device holds", T.nowhere, "not_found"],
    ["a device no one signed in", "nowhere/lane", "not_found"],
  ] as const)(
    "#given %s #when ThreadSdk.send addresses it #then its error has no nested kind",
    async (_case, thread, code) => {
      const td = createTwoDevices()
      cleanups.push(td.cleanup)
      const answer = (await sdkOver(td).send({ thread, text: "x" })) as {
        readonly kind: string
        readonly error?: Readonly<Record<string, unknown>>
      }
      expect(answer.kind).toBe("error")
      expect(answer.error?.["code"]).toBe(code)
      expect(Object.keys(answer.error ?? {}).toSorted()).not.toContain("kind")
    },
  )
})
