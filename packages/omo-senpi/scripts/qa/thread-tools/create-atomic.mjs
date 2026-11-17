#!/usr/bin/env bun
// #14060 on a REAL rpc host with the built omo extension: thread_create on this device creates its thread under the id
// the call's idempotency key derives (open_session.durableSessionId, host capability durable_session_id), so a create
// whose reply is lost is found again. The cell creates with a key, then runs the same create again: both answer the same
// id, it is the derived UUID-shaped (version 8) id, the host holds one session under it, and the prompt arrived once.
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import {
  HostClient,
  makeScratch,
  startRealHost,
  startFakeModelServer,
  writeMockModelsJson,
  installCleanupHooks,
  cleanupAllAndWait,
  createReport,
  flag,
  pgrepPids,
  stopOwnedShardHosts,
  verifyCleanup,
} from "./lib/harness.mjs"

const report = createReport("create-atomic")
installCleanupHooks()
const scratch = makeScratch("create-atomic")
const BRIEF = "QA-14060-BRIEF reply with exactly CHILD_OK."
const evalCall = (summary, code) => ({ name: "eval", args: { language: "js", summary, code } })
// One fake model serves both sessions and the engine's own side requests, so each answer is chosen from the request it
// answers (the server records a request before it picks the turn): the caller's two asks get one cell each, the created
// thread and everything else get text.
const textOf = (message) =>
  typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => part?.text ?? "").join("")
      : ""
const CREATE = evalCall(
  "QA: create twice under one idempotency key",
  `const args = { name: "qa-14060-child", prompt: ${JSON.stringify(BRIEF)}, idempotency_key: "qa-14060-key" }; const a = JSON.parse((await tool.thread_create(args)).text); const b = JSON.parse((await tool.thread_create(args)).text); const list = JSON.parse((await tool.thread_list({ all_scope: true })).text); print(JSON.stringify({ a: a.thread?.thread_id ?? a.error?.code, b: b.thread?.thread_id ?? b.error?.code, named: list.threads.filter((t) => t.name === "qa-14060-child").length }))`,
)
let fake
const choose = () => {
  const messages = fake?.requests.at(-1)?.messages ?? []
  const last = messages.at(-1)
  const lastUser = textOf([...messages].reverse().find((message) => message.role === "user"))
  if (last?.role !== "user") return { text: "done" }
  if (lastUser.includes("Create the child thread")) return { toolCalls: [CREATE] }
  return { text: "CHILD_OK" }
}
fake = await startFakeModelServer(
  new Proxy([], {
    get: (target, key) => (key === "length" ? 1e9 : /^\d+$/.test(String(key)) ? choose() : Reflect.get(target, key)),
  }),
)
writeMockModelsJson(scratch.agentDir, fake)
const extension = join(process.cwd(), "packages/omo-senpi/plugin/extensions/omo.js")
const configAgent = join(scratch.dir, ".omo", "agent")
mkdirSync(configAgent, { recursive: true })
await Bun.write(join(configAgent, "settings.json"), "{}")
await Bun.write(join(configAgent, "models.json"), await Bun.file(join(scratch.agentDir, "models.json")).text())
const socketPath = join(configAgent, "rpc", "rpc.sock")
scratch.env.SENPI_RPC_SOCKET = socketPath
delete scratch.env.OMO_CODING_AGENT_DIR
delete scratch.env.CODING_AGENT_DIR
scratch.env.HOME = scratch.dir
const host = await startRealHost(scratch, {
  socketPath,
  extraArgs: ["--provider", "mock", "--model", "mock-model", "--extension", extension],
})
const client = await HostClient.connect(host.socket, "create-atomic")
const caller = await client.openSession({ cwd: scratch.cwd })
await client.promptAndSettle(caller.routingId, "Create the child thread with its brief.", {
  streamingBehavior: "followUp",
})

for (const message of await client.messages(caller.routingId)) {
  if (message.role === "toolResult" || message.role === "tool" || message.role === "assistant")
    report.log(`caller_${message.role}=${JSON.stringify(message.content ?? null).slice(0, 500)}`)
}
const cell = (await client.messages(caller.routingId))
  .filter((message) => message.role === "toolResult" || message.role === "tool")
  .map((message) => textOf(message))
  .find((text) => text.includes('"named"'))
const answer = (() => {
  try {
    return JSON.parse(cell?.match(/\{"a".*\}/)?.[0] ?? "null")
  } catch {
    return null
  }
})()
const briefs = fake.requests.filter((request) =>
  (Array.isArray(request.messages) ? request.messages : []).some(
    (message) => message.role === "user" && textOf(message).includes("QA-14060-BRIEF") && message === request.messages.at(-1),
  ),
).length
report.log(`cell=${JSON.stringify(cell ?? null).slice(0, 400)} brief_requests=${briefs}`)
report.assert(
  "create-uses-the-derived-id",
  typeof answer?.a === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(answer.a),
  `a=${answer?.a}`,
)
report.assert("same-key-answers-the-same-thread", answer?.b === answer?.a, `a=${answer?.a} b=${answer?.b}`)
report.assert("one-thread-under-the-name", answer?.named === 1, `named=${answer?.named}`)
report.assert("prompt-admitted-once", briefs === 1, `brief_requests=${briefs}`)
const shardSockets = stopOwnedShardHosts(scratch.dir)
await cleanupAllAndWait()
const lateShards = stopOwnedShardHosts(scratch.dir)
const shardSurvivors = [...shardSockets, ...lateShards].flatMap((socket) => pgrepPids(socket))
report.assert(
  "shard-hosts-stopped",
  shardSurvivors.length === 0,
  `shards=${JSON.stringify(shardSockets)} late_shards=${JSON.stringify(lateShards)} survivor_pids=${JSON.stringify(shardSurvivors)}`,
)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
