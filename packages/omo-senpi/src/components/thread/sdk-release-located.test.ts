import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOmoSdk } from "../omo-sdk"
import { assembleOmoSdk } from "../omo-sdk/assembly"
import type { GatewayEndpointRef } from "./gateway/adapter"
import { createGatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost, ThreadHostSession } from "./tools"

// Design lane ruling on threads.release (P1b): one core function releases a row the caller located. The thread facade
// reaches it through the internal assembly with the row it was given; the public root call resolves its thread string
// and then calls it. Neither path is a public member of the root.
const FIRST = "/tmp/i-1111111111111111.sock"
const MOVED = "/tmp/i-2222222222222222.sock"
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function movableHost() {
  let socket = FIRST
  const released: string[] = []
  const session = (): ThreadHostSession => ({
    sessionId: "rpc-1",
    durableSessionId: "dur-host",
    cwd: process.cwd(),
    name: "host lane",
    status: "open",
    socket,
    endpoint_kind: "rpc_host",
  })
  const unused = async (): Promise<never> => {
    throw new Error("not used by a release")
  }
  const host: ThreadHost = {
    socket: "/tmp/release-located-legacy.sock",
    listSessions: async () => [session()],
    listView: async () => ({
      sessions: [session()],
      hosts: [{ socket, list_sessions: { sessions: [session()] }, endpoint_kind: "rpc_host", alive: true as const }],
      disk: [],
    }),
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
    gateway: {
      wake: async () => ({ admitted: [] }),
      releaseSession: async (endpoint: GatewayEndpointRef) => {
        released.push(endpoint.socket)
        return {
          success: true,
          data: {
            released: true,
            session_path: "/s.jsonl",
            attachments: 0,
            dropped: { deliveries: [], user_messages: [] },
          },
        }
      },
    },
  }
  return { host, released, move: () => (socket = MOVED) }
}

function surfaces() {
  const agentDir = mkdtempSync(join(tmpdir(), "release-located-"))
  const store = createGatewayStore({ agentDir })
  const { host, released, move } = movableHost()
  const options = { agentDir, cwd: process.cwd(), uid: 501, user: "qa-user", host, store }
  const sdk = createThreadSdk(options)
  const root = assembleOmoSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa-user", ports: { host, store } }, {})
  cleanups.push(async () => {
    await sdk.dispose()
    await root.dispose()
    rmSync(agentDir, { recursive: true, force: true })
  })
  return { sdk, root, released, move }
}

describe("releasing a located thread", () => {
  test("#given a thread that moved to another host after it was located #when the facade releases the located row #then the release goes to the host it was located on", async () => {
    const { sdk, released, move } = surfaces()
    const located = await sdk.locate({ thread: "dur-host" })
    if (located.kind !== "ok") throw new Error("located")
    move()
    expect(await sdk.release(located.thread, {})).toMatchObject({ success: true })
    expect(released).toEqual([FIRST])
  })

  test("#given the same move #when the public root call releases the thread by its id #then it resolves again and releases where the thread is now", async () => {
    const { root, released, move } = surfaces()
    move()
    expect(await root.threads.release({ thread: "dur-host" })).toMatchObject({ kind: "ok", value: { success: true } })
    expect(released).toEqual([MOVED])
  })

  test("#given a thread no host lists #when the public root call releases it #then it answers not_found and releases nothing", async () => {
    const { root, released } = surfaces()
    expect(await root.threads.release({ thread: "dur-gone" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
    expect(released).toEqual([])
  })
})

describe("the located-row release stays internal", () => {
  test("#given the public root #when its thread members and the public entries' exports are read #then neither names the internal release", async () => {
    const root = createOmoSdk({ env: {}, cwd: tmpdir() })
    expect(Object.keys(root.threads)).not.toContain("releaseLocated")
    expect(Object.keys(await import("../omo-sdk"))).toEqual(["createOmoSdk"])
    // @ts-expect-error the public options carry no internal member
    expect(() => createOmoSdk({ env: {}, releaseLocated: () => undefined })).not.toThrow()
  })

  // Architecture contract (design 7.5 and the ruling): the facade's runtime imports reach the root's thread-only assembly,
  // the root's failure conversions and the thread contract only, never a thread-core module; type-only imports are erased.
  test("#given the thread facade's source #when its value imports are listed #then none reaches a thread-core module", () => {
    const source = readFileSync(join(import.meta.dir, "sdk.ts"), "utf8")
    const valueImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)].map((match) => match[1])
    expect(valueImports.toSorted()).toEqual([
      "../omo-sdk/thread-assembly",
      "../omo-sdk/root/extension-codes",
      "../omo-sdk/root/thread-failures",
      "./contracts",
    ])
  })
})
