import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { Server } from "node:http"
import { connect, Server as NetServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentSession, CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { loadSenpiBarrel } from "../../../lazy/senpi-barrel"
import { assistant, streamMessage } from "../../__fixtures__/in-process-fallback-session"
import type { ChildSpec } from "../../in-process"

// #9413. A machine whose in-process children load the real builtin extensions (codemode included)
// and talk to a local fake provider: only the provider's replies are faked.

export type ChildTurn = "succeeds" | "fails"

const PROVIDER = "runtime-fallback-test"

export type BuiltinChildMachine = {
  readonly cwd: string
  readonly agentDir: string
  readonly modelRuntime: NonNullable<CreateAgentSessionOptions["modelRuntime"]>
  readonly modelRegistry: NonNullable<CreateAgentSessionOptions["modelRegistry"]>
  readonly model: NonNullable<CreateAgentSessionOptions["model"]>
  spec(taskId: string, turn: ChildTurn): ChildSpec
  cleanup(): void
}

export async function createBuiltinChildMachine(): Promise<BuiltinChildMachine> {
  const senpi = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-9413-"))
  const agentDir = join(root, "agent")
  const cwd = join(root, "work")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const modelRuntime = senpi.ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false })
  const modelRegistry = new senpi.ModelRegistry(modelRuntime)
  const provider = {
    api: "openai-completions",
    baseUrl: "file://runtime-fallback-test",
    apiKey: "test-key",
    models: [testModel("child-succeeds"), testModel("child-fails")],
    streamSimple(model: { readonly id: string }) {
      return streamMessage(
        model.id === "child-fails"
          ? assistant(model.id, "error", "", "the provider rejected the child turn")
          : assistant(model.id, "stop", "child done"),
      )
    },
  }
  Reflect.apply(modelRegistry.registerProvider, modelRegistry, [PROVIDER, provider])
  const find = (id: string) => {
    const model = modelRegistry.find(PROVIDER, id)
    if (model === undefined) throw new Error(`${id} missing from the fake provider`)
    return model
  }
  return {
    cwd,
    agentDir,
    modelRuntime,
    modelRegistry,
    model: find("child-succeeds"),
    spec: (taskId, turn) => {
      const id = turn === "succeeds" ? "child-succeeds" : "child-fails"
      return {
        taskId,
        cwd,
        sessionDir: join(root, "children", taskId),
        agentDir,
        projectTrusted: false,
        modelRuntime,
        modelRegistry,
        model: find(id),
        selectedModel: `${PROVIDER}/${id}`,
        retry: { maxRetries: 0 },
        depth: 1,
        parentSessionId: "parent-9413",
        rootSessionId: "parent-9413",
        prompt: "reply with done",
        promptEnvelope: "bare",
      }
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/** The session the in-process runner's default seam opens: builtins reloaded, then bound for print mode. */
export async function openBoundSession(options: CreateAgentSessionOptions): Promise<AgentSession> {
  await options.resourceLoader?.reload()
  const { session } = await (await loadSenpiBarrel()).createAgentSession(options)
  await session.bindExtensions({ mode: "print" })
  return session
}

export type ServerWatch = {
  /** Every node:http or node:net server that started listening while the watch was armed. */
  readonly servers: readonly Server[]
  stop(): void
}

export function watchHttpServers(): ServerWatch {
  // Hook both prototypes: node:http's Server extends node:net's, and a runtime may route an http
  // server's listen through either one. A server seen through both is recorded once.
  const servers: Server[] = []
  const restore: Array<() => void> = []
  for (const proto of [Server.prototype, NetServer.prototype] as const) {
    const listen = proto.listen
    proto.listen = function (this: Server, ...args: unknown[]) {
      if (!servers.includes(this)) servers.push(this)
      return Reflect.apply(listen, this, args)
    } as typeof listen
    restore.push(() => {
      proto.listen = listen
    })
  }
  return { servers, stop: () => restore.reverse().forEach((undo) => undo()) }
}

export function loopbackPort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server is not bound to a TCP port")
  return address.port
}

const CONNECT_PROBE_MS = 2_000

/** Whether a loopback port accepts a connection; a probe that neither connects nor errors counts as closed. */
export function acceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    socket.setTimeout(CONNECT_PROBE_MS, () => {
      socket.destroy()
      resolve(false)
    })
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}

function testModel(id: string) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"] as Array<"text">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}
