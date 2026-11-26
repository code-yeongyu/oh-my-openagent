import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "../../../senpi-test-runtime"
import type { GatewayEndpointPort, RuntimePhase, SessionRuntimePort } from "./adapter"
import { createInboxDrain } from "./drain"
import { createGatewayEngine, resolveFromEntries } from "./engine"
import { createGatewayStore } from "./store"

type Session = Awaited<ReturnType<typeof createAgentSession>>["session"]

const PROBE = /STEER-ALL-PROBE-\d+/g
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Every probe a provider request newly carries: the probes in the messages after its last assistant message. */
function freshProbes(body: { readonly messages?: readonly { readonly role: string; readonly content: unknown }[] }) {
  const messages = body.messages ?? []
  let tail = messages.length
  while (tail > 0 && messages[tail - 1]?.role !== "assistant") tail--
  return messages
    .slice(tail)
    .flatMap((message) => [...JSON.stringify(message.content).matchAll(PROBE)].map((m) => m[0]))
}

function sse(text: string): Response {
  const base = { id: "c", object: "chat.completion.chunk", created: 0, model: "steer-all" }
  const frames = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]
  const body = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

async function engineSession(root: string, baseUrl: string): Promise<Session> {
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always", enabledBuiltinExtensions: [] })
  const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
  registry.registerProvider("steer-all", {
    api: "openai-completions",
    baseUrl,
    apiKey: "fixture-key",
    models: [
      {
        id: "steer-all",
        name: "steer-all",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 4096,
      },
    ],
  })
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd: root,
    agentDir,
    settingsManager,
    modelRegistry: registry,
    model: registry.find("steer-all", "steer-all"),
    thinkingLevel: "off",
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    autoTitleSessions: false,
    tools: [],
  })
  cleanups.push(async () => {
    session.dispose()
    await session.whenToolChildClosed()
  })
  return session
}

/** The target's runtime port exactly as the control endpoint registrant builds it (registration.ts). */
function runtimeOf(session: Session): SessionRuntimePort {
  return {
    phase: (): RuntimePhase => (session.isIdle ? "idle" : "mid_turn"),
    admissionGate: () => session.externalAdmission.gate(),
    admitExternalMessage: (input) => session.externalAdmission.admit(input),
    listAdmittedDeliveries: () => session.externalAdmission.list(),
  }
}

function settledRun(session: Session, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`the woken run did not end within ${timeoutMs} ms`))
    }, timeoutMs)
    const off = session.subscribe((event) => {
      if (event.type !== "agent_end") return
      clearTimeout(timer)
      off()
      resolve()
    })
  })
}

/** A real engine session behind an offline gateway target `B`, whose provider calls `respond` per request. */
async function steerAllWorld(respond: (index: number) => Promise<void> = async () => undefined) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-steer-all-")))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const requests: string[][] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      requests.push(freshProbes((await request.json()) as Parameters<typeof freshProbes>[0]))
      await respond(requests.length)
      return sse(`ack ${requests.length}`)
    },
  })
  cleanups.push(() => server.stop(true))
  const session = await engineSession(root, `http://127.0.0.1:${server.port}/v1`)
  const store = createGatewayStore({ agentDir: join(root, "agent") })
  cleanups.push(() => store.dispose())
  const offline: GatewayEndpointPort = {
    wake: async () => {
      throw new Error("the target is offline")
    },
    releaseSession: async () => {
      throw new Error("never released")
    },
  }
  const engine = createGatewayEngine({
    store,
    endpoints: offline,
    resolve: resolveFromEntries(
      () => [
        {
          thread_id: "B",
          name: "b",
          status: "resumable",
          cwd: root,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
          endpoint: null,
          liveness: "dead",
        },
      ],
      () => root,
    ),
  })
  const send = async (texts: readonly string[]) => {
    for (const text of texts) {
      const result = await engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text })
      expect(result.kind).toBe("ok")
    }
  }
  const drain = createInboxDrain({ store, runtime: runtimeOf(session), durableId: "B", sessionPath: () => null })
  cleanups.push(() => drain.stop())
  return { session, requests, send, drain }
}

test("#given five deliveries queued for an idle session #when one drain pass admits them #then the first model request carries all five, in send order, and no second request follows", async () => {
  // given
  const { session, requests, send, drain } = await steerAllWorld()
  const sent = ["STEER-ALL-PROBE-1", "STEER-ALL-PROBE-2", "STEER-ALL-PROBE-3", "STEER-ALL-PROBE-4", "STEER-ALL-PROBE-5"]
  await send(sent)
  const ended = settledRun(session, 20_000)

  // when
  await drain.drain({ reason: "start" })
  await ended

  // then
  expect(requests).toEqual([sent])
  expect(session.externalAdmission.list().pending).toEqual([])
})

test("#given a turn that is running #when three deliveries arrive before it ends #then the next request carries all three together in send order, as one injection in the same run", async () => {
  // given
  const firstRequest = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const { session, requests, send, drain } = await steerAllWorld(async (index) => {
    if (index !== 1) return
    firstRequest.resolve()
    await release.promise
  })
  let runs = 0
  session.subscribe((event) => {
    if (event.type === "agent_start") runs += 1
  })
  await send(["STEER-ALL-PROBE-0"])
  const ended = settledRun(session, 20_000)
  await drain.drain({ reason: "start" })
  await firstRequest.promise

  // when
  const busy = ["STEER-ALL-PROBE-1", "STEER-ALL-PROBE-2", "STEER-ALL-PROBE-3"]
  await send(busy)
  const admitted = await drain.drain({ reason: "inbox" })
  release.resolve()
  await ended

  // then
  expect(admitted.admitted.map((entry) => entry.kind)).toEqual(["steered", "steered", "steered"])
  expect(requests).toEqual([["STEER-ALL-PROBE-0"], busy])
  expect(runs).toBe(1)
  expect(session.externalAdmission.list().pending).toEqual([])
})
