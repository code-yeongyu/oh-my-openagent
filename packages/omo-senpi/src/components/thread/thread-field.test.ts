import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { threadToolParamSchemas, type ThreadToolName } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"

// #14044 step 4a: one field names a session across the thread tools. Every input that names a session is `thread`, and
// every result that names one carries `thread`, the exact string the verbs take back. The scan reads the schemas and the
// text the model receives from real tool calls, so a new verb, field or result shape is covered without editing a list.

const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Keys that name a session, or reach it through an endpoint, under any name but `thread`. */
const FOREIGN_ADDRESS_KEYS = new Set([
  "thread_id",
  "threadId",
  "sessionId",
  "session_id",
  "durableSessionId",
  "durable_session_id",
  "durable_id",
  "routing_id",
  "socket",
  "sessionPath",
  "session_path",
  "session_file",
  "endpoint_kind",
  "attachments",
  "retain_on_disconnect",
])

/** An input name that looks like a session address: every one of them must be exactly `thread`. */
const ADDRESS_INPUT = /^(thread|session|target|address)(_?id)?$/i

function tools() {
  const session: ThreadHostSession = {
    sessionId: "route-peer",
    durableSessionId: "dur-peer",
    cwd: process.cwd(),
    name: "peer",
    status: "open",
    sessionPath: "/tmp/peer.jsonl",
    socket: "/tmp/thread-field-test.sock",
  }
  const sessions: ThreadHostSession[] = [
    session,
    { sessionId: "route-other", durableSessionId: "dur-other", cwd: process.cwd(), name: "other", status: "open" },
  ]
  const host: ThreadHost = {
    socket: "/tmp/thread-field-test.sock",
    listSessions: async () => sessions,
    openSession: async () => session,
    getMessages: async () => [{ role: "user", content: "hello" }],
    getState: async () => ({ isStreaming: false }),
    prompt: async () => ({ turnId: "turn-1" }),
    interrupt: async () => ({ interrupted: false }),
    setSessionName: async () => {},
    setModel: async (_sessionId, provider, id) => ({ provider, id, name: "Model" }),
    getAvailableModels: async () => [{ provider: "openai", id: "gpt-x", name: "GPT X" }],
    setThinkingLevel: async () => {},
    getAvailableThinkingLevels: async () => ["off", "high"],
    closeSession: async () => "closed",
  }
  const agentDir = mkdtempSync(join(tmpdir(), "thread-field-"))
  directories.push(agentDir)
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  const registered = createThreadTools({
    host,
    store,
    stateDirectory: agentDir,
    callerSessionId: () => "dur-other",
    callerWorkspaceRoot: () => process.cwd(),
  })
  let call = 0
  /** The JSON text the model reads, parsed: never the details object. */
  return async (name: ThreadToolName, args: unknown): Promise<Record<string, unknown>> => {
    const tool = registered.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`${name} is not registered`)
    const ectx = { sessionManager: { getSessionId: () => "dur-other" } }
    const output = await tool.execute(`call-${++call}`, args, undefined, undefined, ectx as never)
    const [content] = output.content as readonly { readonly type: string; readonly text: string }[]
    return JSON.parse(content?.text ?? "null") as Record<string, unknown>
  }
}

function foreignAddresses(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => foreignAddresses(item, `${path}[${index}]`))
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [
    ...(FOREIGN_ADDRESS_KEYS.has(key) ? [`${path}.${key}`] : []),
    ...(key === "thread" && typeof child !== "string" ? [`${path}.thread is ${typeof child}, not the address`] : []),
    ...foreignAddresses(child, `${path}.${key}`),
  ])
}

const inputNames = (name: ThreadToolName): readonly string[] =>
  Object.keys((threadToolParamSchemas[name] as { readonly properties: Record<string, unknown> }).properties)

describe("one field names a session (#14044 4a)", () => {
  test("#given every thread verb's schema #when its inputs are read #then a session address input is named thread and nothing else", () => {
    const offenders = (Object.keys(threadToolParamSchemas) as ThreadToolName[]).flatMap((name) =>
      inputNames(name)
        .filter((input) => input !== "thread" && ADDRESS_INPUT.test(input))
        .map((input) => `${name}.${input}`),
    )
    expect(offenders).toEqual([])
  })

  test("#given a thread_list row #when every session verb runs on its thread value #then each answer names the session as thread and only as thread", async () => {
    // given
    const run = tools()
    const listed = await run("thread_list", {})
    const rows = listed["threads"] as readonly Record<string, unknown>[]
    const peer = rows.find((row) => row["name"] === "peer")
    if (peer === undefined) throw new Error(`thread_list did not list the peer: ${JSON.stringify(listed)}`)
    const thread = peer["thread"]

    // when: each verb gets back exactly the string the list showed
    const answers: Partial<Record<ThreadToolName, Record<string, unknown>>> = {
      thread_list: listed,
      thread_read: await run("thread_read", { thread }),
      thread_send: await run("thread_send", { thread, message: "hi" }),
      thread_handoff: await run("thread_handoff", { thread, message: "go" }),
      thread_interrupt: await run("thread_interrupt", { thread }),
      thread_rename: await run("thread_rename", { thread, name: "peer renamed" }),
      thread_set_model: await run("thread_set_model", { thread, model: "openai/gpt-x" }),
      thread_set_reasoning: await run("thread_set_reasoning", { thread, level: "high" }),
      thread_close: await run("thread_close", { thread }),
      thread_create: await run("thread_create", { name: "fresh" }),
    }

    // then: every verb is either scanned here or a relay tool, addressed by binding, never by session
    const unscanned = (Object.keys(threadToolParamSchemas) as ThreadToolName[]).filter(
      (name) => answers[name] === undefined && !inputNames(name).includes("binding_id"),
    )
    expect(unscanned).toEqual([])
    expect(typeof thread).toBe("string")
    for (const [name, answer] of Object.entries(answers)) {
      expect({ name, kind: answer?.["kind"], error: answer?.["error"] }).toEqual({
        name,
        kind: "ok",
        error: undefined,
      })
      expect({ name, foreign: foreignAddresses(answer) }).toEqual({ name, foreign: [] })
      if (name !== "thread_list" && answer?.["thread"] !== undefined)
        expect({ name, accepts: inputNames(name as ThreadToolName).includes("thread") }).toEqual({
          name,
          accepts: true,
        })
    }
    for (const name of [
      "thread_read",
      "thread_send",
      "thread_handoff",
      "thread_interrupt",
      "thread_rename",
      "thread_set_model",
      "thread_set_reasoning",
      "thread_close",
    ] as const)
      expect({ name, thread: answers[name]?.["thread"] }).toEqual({ name, thread })
    expect(typeof answers.thread_create?.["thread"]).toBe("string")
  })
})
