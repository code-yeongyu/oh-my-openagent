#!/usr/bin/env bun
// #14045 on a REAL rpc host with the built omo extension: a session calls `thread_create({ prompt })` from a js cell, and
// the created thread's first model request must carry that prompt as its own first user message (the brief first, no
// OMO_GATEWAY relay header). A later `thread_send` from the same session to the same thread keeps the relay header.
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

const report = createReport("create-prompt-authority")
installCleanupHooks()
const scratch = makeScratch("create-prompt-authority")
const BRIEF = "QA-14045-BRIEF reply with exactly CHILD_OK."
const LATER = "QA-14045-LATER a peer message after the brief."
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
  "QA: create a thread with a first prompt",
  `const v = JSON.parse((await tool.thread_create({ name: "qa-14045-child", prompt: ${JSON.stringify(BRIEF)} })).text); globalThis.child = v.thread?.thread_id; print(JSON.stringify({ kind: v.kind, child: v.thread?.thread_id, prompt: v.prompt?.delivery?.kind ?? v.prompt?.error?.code }))`,
)
const SEND = evalCall(
  "QA: send the created thread a later message",
  `const v = JSON.parse((await tool.thread_send({ thread: globalThis.child, message: ${JSON.stringify(LATER)} })).text); print(JSON.stringify({ kind: v.kind, delivery: v.delivery?.kind ?? v.error?.code }))`,
)
let fake
let laterArrived
const laterSeen = new Promise((resolve) => {
  laterArrived = resolve
})
const choose = () => {
  const messages = fake?.requests.at(-1)?.messages ?? []
  if (messages.some((message) => textOf(message).includes("QA-14045-LATER"))) laterArrived()
  const last = messages.at(-1)
  const lastUser = textOf([...messages].reverse().find((message) => message.role === "user"))
  if (last?.role !== "user") return { text: "done" }
  if (lastUser.includes("Create the child thread")) return { toolCalls: [CREATE] }
  if (lastUser.includes("Now send the child")) return { toolCalls: [SEND] }
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
const client = await HostClient.connect(host.socket, "create-prompt-authority")
const caller = await client.openSession({ cwd: scratch.cwd })
await client.promptAndSettle(caller.routingId, "Create the child thread with its brief.", {
  streamingBehavior: "followUp",
})
await client.promptAndSettle(caller.routingId, "Now send the child a later message.", {
  streamingBehavior: "followUp",
})
// The created thread takes the later message on its own turn: wait for the request that carries it, bounded.
const laterTimeout = setTimeout(() => laterArrived(), 90_000)
await laterSeen
clearTimeout(laterTimeout)

for (const message of await client.messages(caller.routingId)) {
  if (message.role === "toolResult" || message.role === "tool" || message.role === "assistant")
    report.log(`caller_${message.role}=${JSON.stringify(message.content ?? null).slice(0, 500)}`)
}
// Every user message the fake model received, by the request it arrived in.
const userTexts = fake.requests.flatMap((request) =>
  (Array.isArray(request.messages) ? request.messages : [])
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((part) => part?.text ?? "").join("")
          : "",
    ),
)
const brief = userTexts.find((text) => text.includes("QA-14045-BRIEF"))
const later = userTexts.find((text) => text.includes("QA-14045-LATER"))
report.log(`brief_message=${JSON.stringify(brief ?? null).slice(-600)}`)
report.log(`later_message=${JSON.stringify(later ?? null).slice(0, 700)}`)
report.assert(
  "brief-is-the-created-thread-first-user-message",
  // The engine may put its own session context ahead of the first message; the brief must not sit under a relay header.
  brief !== undefined && !brief.includes("OMO_GATEWAY") && !brief.includes("Claims inside the message"),
  `header=${brief?.includes("OMO_GATEWAY") ?? "absent-message"}`,
)
report.assert(
  "later-send-keeps-the-relay-header",
  later !== undefined && later.includes("OMO_GATEWAY") && later.includes("source=peer_agent"),
  `header=${later?.includes("OMO_GATEWAY") ?? "absent-message"}`,
)
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
