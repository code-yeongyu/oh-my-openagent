import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

import type { ThreadToolName, ThreadToolResult } from "./contracts"
import { setModelOn, setThinkingLevelOn } from "./control/operations"
import { createRelayControl } from "./control/relay-control"
import { createGatewayStore } from "./gateway/store"
import { createLiveThreadSurface } from "./live-surface"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./remote/ports"
import { createThreadTools, type ThreadHost } from "./tools"

// #13485 against the REAL pinned engine: a thread's model and reasoning change on that session only. Each test runs the
// engine on its own temp HOME and agent dir (never a real device's settings.json), changes the session through the
// thread tools on the engine's own listening socket (this device) or the relay control (another device), and compares
// the device-wide settings.json byte for byte once the engine has exited, so a write the engine flushes late is counted.

const TEST_BUDGET_MS = 60_000
setDefaultTimeout(TEST_BUDGET_MS)

const roots: string[] = []
const engines = new Set<ChildProcess>()
const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  for (const engine of engines) engine.kill("SIGKILL")
  engines.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const within = <T>(promise: Promise<T>, what: string, ms = 30_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}, it never came`)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

function senpiCli(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve("@code-yeongyu/senpi/package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: string | Record<string, string> }
  const bin = typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0]
  if (bin === undefined) throw new Error("the pinned senpi package names no bin")
  return resolve(dirname(manifestPath), bin)
}

const SETTINGS = `${JSON.stringify(
  { defaultProvider: "faux", defaultModel: "faux-a", defaultThinkingLevel: "medium" },
  null,
  2,
)}\n`

const fauxModel = (id: string) => ({
  id,
  name: id,
  reasoning: true,
  input: ["text"],
  contextWindow: 128_000,
  maxTokens: 8_192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

function sandbox() {
  const home = mkdtempSync("/tmp/thr-scope.")
  roots.push(home)
  const agentDir = join(home, "agent")
  mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(agentDir, "settings.json"), SETTINGS, { mode: 0o600 })
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        faux: {
          baseUrl: "http://127.0.0.1:9/v1",
          api: "openai-completions",
          apiKey: "unused",
          models: [fauxModel("faux-a"), fauxModel("faux-b")],
        },
      },
    }),
    { mode: 0o600 },
  )
  return { home, agentDir, settingsPath: join(agentDir, "settings.json") }
}

type Reply = { readonly success?: boolean; readonly data?: JsonObject; readonly error?: string } & JsonObject

const engineEnv = (home: string, agentDir: string) => ({
  HOME: home,
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: home,
  OMO_CODING_AGENT_DIR: agentDir,
  SENPI_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_DIR: agentDir,
})

function startEngine(home: string, agentDir: string) {
  const engine = spawn(process.execPath, [senpiCli(), "--mode", "rpc", "--multi-session", "--no-extensions"], {
    env: engineEnv(home, agentDir),
    stdio: ["pipe", "pipe", "inherit"],
  })
  engines.add(engine)
  const exited = once(engine, "exit")
  let buffered = ""
  let next = 0
  const waiting = new Map<string, (reply: Reply) => void>()
  engine.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    buffered += chunk
    for (let newline = buffered.indexOf("\n"); newline !== -1; newline = buffered.indexOf("\n")) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof message !== "object" || message === null) continue
      const record = message as Reply
      if (record["type"] !== "response" || typeof record["id"] !== "string") continue
      waiting.get(record["id"])?.(record)
      waiting.delete(record["id"])
    }
  })
  const request = (record: JsonObject): Promise<Reply> => {
    next += 1
    const id = `engine-${next}`
    const reply = within(
      new Promise<Reply>((resolveReply) => waiting.set(id, resolveReply)),
      `the engine's reply to ${String(record["type"])}`,
    )
    engine.stdin?.write(`${JSON.stringify({ ...record, id })}\n`)
    return reply
  }
  const openSession = async (): Promise<string> => {
    const reply = await request({ type: "open_session", cwd: home })
    const sessionId = reply.data?.["sessionId"]
    if (typeof sessionId !== "string") throw new Error(`open_session answered no session: ${JSON.stringify(reply)}`)
    return sessionId
  }
  const stateOf = async (sessionId: string) => {
    const data = (await request({ type: "get_state", sessionId })).data ?? {}
    const model = data["model"] as { provider?: string; id?: string } | undefined
    return { model: `${model?.provider}/${model?.id}`, thinkingLevel: data["thinkingLevel"] }
  }
  /** Ends the engine through its own stdin and waits for the exit, so every settings write it would flush has landed. */
  const stop = async (): Promise<void> => {
    engine.stdin?.end()
    await within(exited, "the engine to exit")
    engines.delete(engine)
  }
  return { request, openSession, stateOf, stop }
}

/** The engine as the desktop and `omo host` run it: listening on a socket, which this device's thread surface dials. */
async function startListeningEngine(home: string, agentDir: string) {
  const socketPath = join(home, "rpc.sock")
  const engine = spawn(
    process.execPath,
    [senpiCli(), "--mode", "rpc", "--multi-session", "--no-extensions", "--listen", `unix://${socketPath}`],
    { env: engineEnv(home, agentDir), stdio: ["ignore", "pipe", "pipe"] },
  )
  engines.add(engine)
  const exited = once(engine, "exit")
  const listening = Promise.withResolvers<void>()
  let output = ""
  const onOutput = (chunk: Buffer) => {
    output += chunk.toString("utf8")
    if (output.includes("listening on")) listening.resolve()
  }
  engine.stdout?.on("data", onOutput)
  engine.stderr?.on("data", onOutput)
  await within(listening.promise, "the engine to listen")
  const stop = async (): Promise<void> => {
    engine.kill("SIGTERM")
    await within(exited, "the engine to exit")
    engines.delete(engine)
  }
  return { socketPath, stop }
}

function threadToolsOver(host: ThreadHost, stateDirectory: string, home: string) {
  const store = createGatewayStore({ agentDir: stateDirectory })
  closers.push(() => store.dispose())
  const tools = createThreadTools({
    host,
    store,
    stateDirectory,
    callerSessionId: () => "caller",
    callerWorkspaceRoot: () => home,
  })
  let calls = 0
  return async (name: ThreadToolName, args: unknown): Promise<ThreadToolResult> => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`${name} is not registered`)
    calls += 1
    return (await tool.execute(`call-${calls}`, args, undefined, undefined, undefined as never)).details
      .result as ThreadToolResult
  }
}

describe.skipIf(process.platform === "win32")(
  "a thread's model and reasoning change on that session only (#13485)",
  () => {
    test("#given a session on this device's real engine #when thread_set_model and thread_set_reasoning run #then the session switched and the device's settings.json is byte-identical", async () => {
      // given
      const { home, agentDir, settingsPath } = sandbox()
      const before = readFileSync(settingsPath)
      const engine = await startListeningEngine(home, agentDir)
      const host = createLiveThreadSurface({} as never, {
        env: { SENPI_RPC_SOCKET: engine.socketPath },
        keyRoot: agentDir,
        statusAll: async () => undefined,
        registry: async () => [],
      })
      const session = await host.openSession({ cwd: home })
      const run = threadToolsOver(host, join(home, "thread-state"), home)
      const thread = session.durableSessionId ?? session.sessionId

      // when
      const model = await run("thread_set_model", { thread, model: "faux/faux-b", all_scope: true })
      const reasoning = await run("thread_set_reasoning", { thread, level: "high", all_scope: true })
      const state = (await host.getState(session.sessionId)) as JsonObject
      await engine.stop()

      // then
      expect(model).toMatchObject({ kind: "ok", model: { provider: "faux", id: "faux-b" } })
      expect(reasoning).toMatchObject({ kind: "ok", level: "high", scope: "session" })
      expect([state["model"], state["thinkingLevel"]]).toMatchObject([{ provider: "faux", id: "faux-b" }, "high"])
      expect(readFileSync(settingsPath).equals(before)).toBe(true)
    })

    test("#given a session on another device's real engine #when the relay control sets its model and reasoning #then the session switched and that device's settings.json is byte-identical", async () => {
      // given
      const { home, agentDir, settingsPath } = sandbox()
      const before = readFileSync(settingsPath)
      const engine = startEngine(home, agentDir)
      const sessionId = await engine.openSession()
      const row: RemoteSessionRow = {
        device: "b",
        session_id: sessionId,
        durable_id: "dur-on-b",
        title: "on b",
        project: home,
        path: "",
        state: "live",
        updated_ms: 0,
      }
      const unused = async (): Promise<never> => {
        throw new Error("not part of this test")
      }
      const remote: RemoteThreadSurface = {
        chain: { stamp: (record) => record },
        sessions: {
          status: async () => ({ state: "connected" }),
          thisDevice: async () => "a",
          devices: async () => [{ device: "b", label: "b", online: true }],
          sessions: async () => [row],
          endpointCommand: unused,
          locate: unused,
          read: unused,
          watch: unused,
          sessionCommand: async (_device, _session, rpc) => {
            const reply = await engine.request(rpc)
            return reply.success === false
              ? { kind: "refused", reason: String(reply.error) }
              : { kind: "ok", response: reply }
          },
        },
      }
      const control = createRelayControl(remote, row)

      // when
      const model = await setModelOn(control, "faux/faux-b", undefined)
      const reasoning = await setThinkingLevelOn(control, "high", undefined)
      const state = await engine.stateOf(sessionId)
      await engine.stop()

      // then
      expect(model).toMatchObject({ kind: "ok", model: { provider: "faux", id: "faux-b" } })
      expect(reasoning).toMatchObject({ kind: "ok", level: "high", scope: "session" })
      expect(state).toEqual({ model: "faux/faux-b", thinkingLevel: "high" })
      expect(readFileSync(settingsPath).equals(before)).toBe(true)
    })
  },
)
