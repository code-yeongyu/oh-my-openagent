import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost } from "./tools"

// Design 4.1: createThreadSdk is a compatibility facade that answers exactly what it shipped. The expected answers are
// the shipped code's own, written by `bun script/capture-shipped-thread-refusals.ts` at dev cab771c006 into the fixture
// beside this file (its base, command and count are in it); every self and not_found refusal of the controls keeps its
// nested kind, field for field and in key order. The older self-address test compares with toMatchObject, which cannot
// see an extra field.
const SHIPPED = (await Bun.file(join(import.meta.dir, "sdk-control-refusals.shipped.json")).json()) as {
  readonly base: string
  readonly count: number
  readonly answers: Readonly<Record<string, unknown>>
}

test("#given a script with no session of its own and an unknown thread #when each control is called #then every answer equals the shipped one, nested fields and key order included", async () => {
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  const host: ThreadHost = {
    socket: "/tmp/capture-legacy.sock",
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
  const agentDir = mkdtempSync(join(tmpdir(), "capture-controls-"))
  const store = createGatewayStore({ agentDir })
  const sdk = createThreadSdk({
    agentDir,
    cwd: process.cwd(),
    uid: 501,
    user: "qa-user",
    host,
    store,
    firstPromptWaitMs: 0,
  })
  const answers = {
    interrupt: await sdk.interrupt({ thread: "self" }),
    closeSelf: await sdk.close({ thread: "self" }),
    closeDefault: await sdk.close({}),
    renameSelf: await sdk.rename({ thread: "self", name: "mine" }),
    renameDefault: await sdk.rename({ name: "mine" }),
    setModel: await sdk.set_model({ thread: "self", model: "opus" }),
    interruptMissing: await sdk.interrupt({ thread: "nope-thread" }),
    closeMissing: await sdk.close({ thread: "nope-thread" }),
    renameMissing: await sdk.rename({ thread: "nope-thread", name: "mine" }),
    setModelMissing: await sdk.set_model({ thread: "nope-thread", model: "opus" }),
    interruptBogus: await sdk.interrupt({ thread: "self", bogus: 1 } as never),
  }
  await sdk.dispose()
  await store.dispose()
  rmSync(agentDir, { recursive: true, force: true })
  expect(SHIPPED.base).toBe("cab771c00642b969d229869d2312996450ce1bf3")
  expect(Object.keys(answers).length).toBe(SHIPPED.count)
  expect(JSON.stringify(answers)).toBe(JSON.stringify(SHIPPED.answers))
})
