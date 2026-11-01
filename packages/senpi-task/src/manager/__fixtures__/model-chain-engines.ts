import { type ChildProcess, spawn } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { RpcHostRunner } from "../../runners/rpc-host"
import { HostSessionClient } from "../../runners/rpc-host/session-client"
import { buildRpcSpawn } from "../../runners/rpc/spawn"
import { RpcProcessRunner } from "../../runners/rpc-process"
import { createRpcManagedRunner } from "../runner"
import type { ManagedRunner } from "../types"
import type { Step } from "./model-chain-answers"
import { ENGINE_MODELS, startHttpProviders } from "./model-chain-http"

const HOST_READY_LINE = "senpi rpc listening on"
const HOST_READY_TIMEOUT_MS = 30_000

export type EngineRunnerKind = "process" | "host"

export type EngineInput = {
  readonly root: string
  readonly settingsPath: string
  readonly scripts: Readonly<Record<string, readonly Step[]>>
}

export type EngineRunner = {
  readonly runner: ManagedRunner
  readonly calls: readonly string[]
  stop(): Promise<void>
}

/** A real senpi engine outside the test process: a per-child process, or a socket host's session. */
export async function startEngineRunner(kind: EngineRunnerKind, input: EngineInput): Promise<EngineRunner> {
  const home = join(input.root, "home")
  const agentDir = join(input.root, `${kind}-agent`)
  mkdirSync(home, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  const providers = startHttpProviders(input.scripts)
  copyFileSync(input.settingsPath, join(agentDir, "settings.json"))
  writeFileSync(join(agentDir, "models.json"), providers.modelsJson)
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify(Object.fromEntries(Object.keys(ENGINE_MODELS).map((provider) => [provider, { type: "api_key", key: "test-key" }]))), { mode: 0o600 })
  const env = { PATH: process.env["PATH"] ?? "", HOME: home, SENPI_CODING_AGENT_DIR: agentDir, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }
  try {
    const engine = kind === "process" ? processEngine(env) : await hostEngine(input.root, env)
    return {
      runner: engine.runner,
      calls: providers.calls,
      stop: async () => {
        await engine.stop()
        await providers.stop()
      },
    }
  } catch (error) {
    await providers.stop()
    throw error
  }
}

type Engine = Omit<EngineRunner, "calls">

function processEngine(env: Readonly<Record<string, string>>): Engine {
  const children: ChildProcess[] = []
  const runner = new RpcProcessRunner({
    modelAdmission: async () => {},
    buildSpawn: (spec) => buildRpcSpawn(spec, { parentEnv: env, resolveSenpiExecutable: () => null }),
    spawnChild: (descriptor) => {
      const child = spawn(descriptor.command, [...descriptor.args], { cwd: descriptor.cwd, env: descriptor.env, stdio: ["pipe", "pipe", "pipe"] })
      children.push(child)
      return child
    },
  })
  return {
    runner: createRpcManagedRunner(runner),
    stop: async () => {
      await runner.settleTeardowns()
      // A finished child stays resident; it must be gone before the world's directories are removed.
      await Promise.all(children.splice(0).map(stopChild))
    },
  }
}

async function hostEngine(root: string, engineEnv: Readonly<Record<string, string>>): Promise<Engine> {
  // A socket host advertises `extension_events` (a capability omo requires of a task host) only for this client set.
  const env = { ...engineEnv, SENPI_RPC_CLIENT_CAPABILITIES: "extension_events" }
  const socketDir = mkdtempSync(join(tmpdir(), "mch-"))
  const socket = join(socketDir, "h.sock")
  const rpcEntry = fileURLToPath(import.meta.resolve("@code-yeongyu/senpi/rpc-entry"))
  const host = spawn(
    process.execPath,
    [rpcEntry, "--listen", socket, "--session-runtime", "in-process", "--no-extensions", "--no-skills"],
    { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] },
  )
  const stop = async () => {
    await stopChild(host)
    rmSync(socketDir, { recursive: true, force: true })
  }
  try {
    await hostListening(host)
  } catch (error) {
    await stop()
    throw error
  }
  const clients: HostSessionClient[] = []
  const runner = new RpcHostRunner({
    createClient: (socketPath) => {
      const client = new HostSessionClient({ socketPath })
      clients.push(client)
      return client
    },
    policy: "upgrade",
    agentDir: join(root, "host-index"),
    env: {},
    heartbeatIntervalMs: 60_000,
    closeGraceMs: 50,
    modelAdmission: () => Promise.resolve(),
    storeDir: join(root, "host-store"),
    shardResolver: () => ({ socket, shard: { kind: "p", key: "0000000000000000", ownerSessionId: "root-0", inherited: false }, root: "primary" }),
    ownHostSocket: () => undefined,
    insideHost: () => false,
    onNotice: () => undefined,
    shardEvents: {},
    ensureDaemon: () => Promise.resolve({ action: "reuse", reason: "compatible", socket, pid: host.pid ?? 0, reused: true, upgradeable: true }),
  })
  return {
    runner: createRpcManagedRunner(runner),
    stop: async () => {
      await runner.settleTeardowns()
      // Detached first: a session whose host vanished under it recovers by re-admitting its store.
      for (const client of clients.splice(0)) await client.detach()
      await stop()
    },
  }
}

function hostListening(host: ChildProcess): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  let stderr = ""
  const timer = setTimeout(() => reject(new Error(`senpi host did not listen within ${HOST_READY_TIMEOUT_MS} ms: ${stderr}`)), HOST_READY_TIMEOUT_MS)
  host.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
    if (stderr.includes(HOST_READY_LINE)) resolve()
  })
  host.once("exit", (code) => reject(new Error(`senpi host exited (${code}) before listening: ${stderr}`)))
  return promise.finally(() => clearTimeout(timer))
}

async function stopChild(host: ChildProcess): Promise<void> {
  if (host.exitCode !== null || host.signalCode !== null) return
  const exited = new Promise<void>((resolve) => host.once("exit", () => resolve()))
  host.kill("SIGTERM")
  await exited
}
