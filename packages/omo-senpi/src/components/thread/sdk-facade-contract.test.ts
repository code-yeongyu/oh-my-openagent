import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { StoreExtensionRegistration } from "./gateway/store-extensions"
import type { RemoteThreadSurface } from "./remote/ports"
import { createThreadSdk, type LocatedThread, type ThreadSdk } from "./sdk"
import type { ThreadHost } from "./tools"

// Public API contract of the shipped thread SDK (runtime/thread-sdk/sdk.js, first-party design 4.1): P1b turns
// createThreadSdk into a compatibility facade over the omo SDK root, and the facade must keep its member set, its
// principal, the store extension pair with its `refused` branch, release's own answer and dispose's lifecycle exactly.

const directories: string[] = []
const sdks: ThreadSdk[] = []
afterEach(async () => {
  await Promise.all(sdks.splice(0).map((sdk) => sdk.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const unused = async (): Promise<never> => {
  throw new Error("not used by this test")
}
const host: ThreadHost = {
  socket: "/tmp/thread-sdk-facade.sock",
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
}

function build(options: {
  readonly store?: (agentDir: string) => GatewayStore
  readonly remote?: RemoteThreadSurface
}) {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-sdk-facade-"))
  directories.push(agentDir)
  const sdk = createThreadSdk({
    agentDir,
    cwd: agentDir,
    uid: 501,
    user: "qa-user",
    host,
    ...(options.store === undefined ? {} : { store: options.store(agentDir) }),
    ...(options.remote === undefined ? {} : { remote: options.remote }),
  })
  sdks.push(sdk)
  return { sdk, agentDir }
}

const moduleUrl = new URL("./gateway/testing/session-callable-extension.mjs", import.meta.url).href
const parameters = {
  type: "object",
  additionalProperties: false,
  required: ["target_session_durable_id"],
  properties: { target_session_durable_id: { type: "string", minLength: 1 } },
}
const registration: StoreExtensionRegistration = {
  name: "gw",
  moduleUrl,
  migrations: [["CREATE TABLE gw_opens (id INTEGER PRIMARY KEY, args TEXT NOT NULL)"]],
  sessionCallable: [{ op: "openThread", toolName: "open", description: "Open a thread.", parameters }],
}

describe("thread SDK facade: the shipped contract", () => {
  test("#given a thread SDK #when its members are listed #then they are exactly the shipped ones and the principal is cli:<uid>", () => {
    const { sdk } = build({})
    expect(Object.keys(sdk).sort()).toEqual([
      "close",
      "create",
      "dispose",
      "extensionCall",
      "interrupt",
      "list",
      "locate",
      "principal",
      "read",
      "registerStoreExtension",
      "release",
      "rename",
      "send",
      "set_model",
      "warmDaemon",
    ])
    expect(sdk.principal).toBe("cli:501")
    for (const [name, member] of Object.entries(sdk))
      if (name !== "principal") expect([name, typeof member]).toEqual([name, "function"])
  })

  test("#given a registered store extension #when a script calls an op, a session-callable op and an unknown extension #then ok carries the value and the other two answer kind refused", async () => {
    const { sdk } = build({})
    const registered = await sdk.registerStoreExtension(registration)
    expect(registered).toEqual({ kind: "ok", value: { version: expect.any(Number) } })
    expect(await sdk.extensionCall("gw", "sql", { sql: "DELETE FROM gw_opens" })).toEqual({ kind: "ok", value: 0 })
    expect(await sdk.extensionCall("gw", "openThread", { target_session_durable_id: "x" })).toMatchObject({
      kind: "refused",
      code: "caller_not_allowed",
    })
    expect(await sdk.extensionCall("nobody", "sql", { sql: "SELECT 1" })).toMatchObject({
      kind: "refused",
      code: "extension_unknown_name",
    })
  })

  test("#given a located thread with no serving endpoint #when released #then the engine-shaped reply says release_unsupported and nothing throws", async () => {
    const { sdk } = build({})
    const thread: LocatedThread = {
      thread_id: "dur-1",
      title: "t",
      cwd: "/",
      status: "resumable",
      session_path: null,
      endpoint: null,
      surface: null,
      alive: false,
    }
    expect(await sdk.release(thread, { interrupt: false })).toEqual({ success: false, error: "release_unsupported" })
  })

  test("#given a remote surface whose close fails #when the SDK is disposed #then the remote sessions close first and the gateway store is still disposed", async () => {
    const order: string[] = []
    const remote = {
      sessions: {
        close: async () => {
          order.push("remote")
          throw new Error("close failed")
        },
      },
    } as unknown as RemoteThreadSurface
    const { sdk } = build({
      remote,
      store: (agentDir) => {
        const store = createGatewayStore({ agentDir })
        return {
          ...store,
          dispose: async () => {
            order.push("store")
            await store.dispose()
          },
        }
      },
    })
    sdks.splice(sdks.indexOf(sdk), 1)
    await sdk.dispose()
    expect(order).toEqual(["remote", "store"])
  })
})
