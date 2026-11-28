import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type SocketHost, startSocketHost } from "../../manager/__fixtures__/model-chain-engines"
import { ENGINE_MODELS, startHttpProviders, type HttpProviders } from "../../manager/__fixtures__/model-chain-http"
import { ChildParentLink, type ParentPermissionMode } from "../parent-link"
import { HostSessionClient } from "./session-client"
import { createSenpiRpcClient, type HostRpcClientFactory } from "./session-transport"

// #12853 M3: the task-host follow push against a REAL senpi host process, not the fake host the other suites use, so
// a drift in what the host does with the push (the child no longer reached, its mode not applied, the push answered
// differently) fails here. The ack is the child's own connection reporting the parent's new mode as a client-named one.

const BUDGET_MS = 30_000
setDefaultTimeout(BUDGET_MS)

const roots: string[] = []
const hosts: SocketHost[] = []
const providers: HttpProviders[] = []
const clients: HostSessionClient[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) await client.detach()
  for (const host of hosts.splice(0)) await host.stop()
  for (const provider of providers.splice(0)) await provider.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function parentMode(initial: string): ParentPermissionMode & { change(preset: string): void } {
  let current = initial
  const listeners = new Set<(preset: string) => void>()
  return {
    current: () => current,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    change: (preset) => {
      current = preset
      for (const listener of listeners) listener(preset)
    },
  }
}

async function realHost(): Promise<{ readonly root: string; readonly socket: string }> {
  const root = mkdtempSync(join(tmpdir(), "rh-follow-"))
  roots.push(root)
  const home = join(root, "home")
  const agentDir = join(root, "agent")
  mkdirSync(home, { recursive: true })
  // The host refuses a group/other-writable agent dir (#12131).
  mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  const provider = startHttpProviders({})
  providers.push(provider)
  writeFileSync(join(agentDir, "models.json"), provider.modelsJson)
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify(
      Object.fromEntries(Object.keys(ENGINE_MODELS).map((name) => [name, { type: "api_key", key: "test-key" }])),
    ),
    { mode: 0o600 },
  )
  const host = await startSocketHost(root, {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    SENPI_CODING_AGENT_DIR: agentDir,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  })
  hosts.push(host)
  return { root, socket: host.socket }
}

// Every client after the child's own connection belongs to a follow push; the push is over once that client stops.
function pushWatchingFactory(): { readonly createClient: HostRpcClientFactory; readonly pushEnded: Promise<void> } {
  const ended = Promise.withResolvers<void>()
  let created = 0
  return {
    pushEnded: ended.promise,
    createClient: async (options) => {
      const client = await createSenpiRpcClient(options)
      created += 1
      if (created === 1) return client
      const stop = client.stop.bind(client)
      client.stop = async () => {
        try {
          await stop()
        } finally {
          ended.resolve()
        }
      }
      return client
    },
  }
}

function within<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`waited ${BUDGET_MS / 2} ms for ${what}`)), BUDGET_MS / 2),
    ),
  ])
}

describe("HostSessionClient following its parent's approval mode on a real host", () => {
  test("#given a child opened in its parent's full-access #when the parent moves to ask #then the host reports the child in ask on the child's own connection", async () => {
    // given
    const { root, socket } = await realHost()
    const mode = parentMode("full-access")
    const warnings: string[] = []
    const watch = pushWatchingFactory()
    const client = new HostSessionClient({
      socketPath: socket,
      ports: { createClient: watch.createClient },
      parent: new ChildParentLink("st_real_follow", undefined, mode, (message) => {
        warnings.push(message)
      }),
    })
    clients.push(client)
    await client.open({
      sessionPath: join(root, "sessions", "child.jsonl"),
      cwd: root,
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "medium",
      kind: "worker",
      context: { role: "child", task_id: "st_real_follow" },
      retainOnDisconnect: true,
      autoTitle: false,
    })
    expect(await client.getState()).toMatchObject({
      permissionPreset: "full-access",
      permissionPresetSource: "client",
      permissionPresetStatus: "applied",
    })

    // when
    mode.change("ask")
    await within(watch.pushEnded, "the follow push to finish")

    // then
    expect(warnings).toEqual([])
    expect(await client.getState()).toMatchObject({
      permissionPreset: "ask",
      permissionPresetSource: "client",
      permissionPresetStatus: "applied",
      effectivePermissionPreset: "ask",
    })
  })
})
