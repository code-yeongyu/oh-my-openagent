#!/usr/bin/env bun
// #14049 on a REAL rpc host with the built omo extension: a session runs one turn and is closed, so no endpoint lists it
// and only its session file is left. A second session then opens it by id with `thread_create({ thread })` from a js
// cell: the open must start it again from that file under the same id, and `thread_read` must read it back.
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

const report = createReport("reopen-exited")
installCleanupHooks()
const scratch = makeScratch("reopen-exited")
const MARK = "QA-14049-EXITED"
const evalCall = (summary, code) => ({ name: "eval", args: { language: "js", summary, code } })
const textOf = (message) =>
  typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => part?.text ?? "").join("")
      : ""
const REOPEN = evalCall(
  "QA: reopen the exited thread by id, then read it",
  // The exited thread is the session whose file carries the first turn's answer; the cell finds its id there.
  `const fs = await import("node:fs"); const path = await import("node:path"); const root = [process.env.SENPI_CODING_AGENT_DIR, process.env.OMO_CODING_AGENT_DIR, process.env.PI_CODING_AGENT_DIR, path.join(process.env.HOME, ".omo", "agent")].filter(Boolean).map((dir) => path.join(dir, "sessions")).find((dir) => fs.existsSync(dir)); const files = fs.readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl")).filter((f) => fs.readFileSync(path.join(root, f), "utf8").includes(${JSON.stringify(MARK)} + " first turn")); const id = files[0]?.match(/_([0-9a-f-]{36})\\.jsonl$/)?.[1]; const opened = JSON.parse((await tool.thread_create({ thread: id })).text); const readBack = JSON.parse((await tool.thread_read({ thread: id })).text); print(JSON.stringify({ kind: opened.kind, code: opened.error?.code ?? null, id, thread: opened.thread ?? null, status: opened.status ?? null, read: readBack.kind, marked: JSON.stringify(readBack).includes(${JSON.stringify(MARK)}) }))`,
)
// Each answer is chosen from the request it answers, so the engine's own side requests cannot take a scripted turn.
let fake
const choose = () => {
  const messages = fake?.requests.at(-1)?.messages ?? []
  const lastUser = textOf([...messages].reverse().find((message) => message.role === "user"))
  if (messages.at(-1)?.role !== "user") return { text: "done" }
  if (lastUser.includes("Answer once")) return { text: `${MARK} first turn answered` }
  if (lastUser.includes("Reopen the exited thread")) return { toolCalls: [REOPEN] }
  return { text: "done" }
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
// The exited thread: one turn, then closed.
const firstHost = await startRealHost(scratch, {
  socketPath,
  extraArgs: ["--provider", "mock", "--model", "mock-model", "--extension", extension],
})
const first = await HostClient.connect(firstHost.socket, "reopen-exited-first")
const exited = await first.openSession({ cwd: scratch.cwd })
await first.promptAndSettle(exited.routingId, "Answer once.", { streamingBehavior: "followUp" })
const exitedId = (await first.listSessions()).find((row) => row.sessionId === exited.routingId)?.durableSessionId
await first.request({ type: "close_session", sessionId: exited.routingId })
const listed = await first.request({ type: "list_sessions" })
const stillListed = JSON.stringify(listed).includes(exitedId)
report.log(`exited_id=${exitedId} still_listed=${stillListed}`)
report.assert("exited-thread-is-listed-nowhere", typeof exitedId === "string" && !stillListed, `id=${exitedId}`)
const caller = await first.openSession({ cwd: scratch.cwd })
await first.promptAndSettle(caller.routingId, "Reopen the exited thread by its id and read it.", {
  streamingBehavior: "followUp",
})

for (const message of await first.messages(caller.routingId)) {
  if (message.role === "toolResult" || message.role === "tool" || message.role === "assistant")
    report.log(`caller_${message.role}=${JSON.stringify(message.content ?? null).slice(0, 500)}`)
}
const messages = await first.messages(caller.routingId)
const cell = messages
  .filter((message) => message.role === "toolResult" || message.role === "tool")
  .map((message) =>
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((part) => part?.text ?? "").join("")
        : "",
  )
  .find((text) => text.includes('"kind"'))
report.log(`cell=${JSON.stringify(cell ?? null).slice(0, 600)}`)
const answer = (() => {
  const match = cell?.match(/\{"kind".*\}/)
  try {
    return match === null || match === undefined ? undefined : JSON.parse(match[0])
  } catch {
    return undefined
  }
})()
report.assert(
  "reopen-by-id-opens-from-the-file",
  answer?.kind === "ok" && answer.id === exitedId && answer.thread === exitedId,
  `kind=${answer?.kind} code=${answer?.code} thread=${answer?.thread}`,
)
report.assert(
  "reopened-thread-reads-back",
  answer?.read === "ok" && answer.marked === true,
  `read=${answer?.read} marked=${answer?.marked}`,
)
const shardSockets = stopOwnedShardHosts(scratch.dir)
await cleanupAllAndWait()
const lateShards = stopOwnedShardHosts(scratch.dir)
const shardSurvivors = [...shardSockets, ...lateShards].flatMap((socket) => pgrepPids(socket))
report.assert("shard-hosts-stopped", shardSurvivors.length === 0, `survivor_pids=${JSON.stringify(shardSurvivors)}`)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
