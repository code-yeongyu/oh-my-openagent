#!/usr/bin/env bun
// #15073 on a REAL rpc host with the built omo extension: a session's js cell calls the thread tools with the argument
// names the fleet census found agents predicting (thread_read limit/tail, thread_list query/limit, thread_send text), and
// with a field no tool takes. Every familiar name must do what it says; the unknown field must be refused with a
// corrected call that the cell can run as given.
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

const report = createReport("familiar-args")
installCleanupHooks()
const scratch = makeScratch("familiar-args")
const CELL = `
const j = async (p) => { const r = await p; try { return JSON.parse(r.text) } catch { return { raw: r.text } } }
const out = {}
const peer = await j(tool.thread_create({ name: "qa-15073-peer" }))
out.create = peer.kind
const thread = peer.thread ?? peer.thread?.thread_id
out.query = await j(tool.thread_list({ query: "QA-15073" }))
out.limit = await j(tool.thread_list({ limit: 1 }))
out.send = await j(tool.thread_send({ thread, text: "QA-15073-TEXT reply with exactly PEER_OK." }))
out.readLimit = await j(tool.thread_read({ thread: "self", limit: 2 }))
out.readTail = await j(tool.thread_read({ thread: "self", tail: 2 }))
out.readBoth = await j(tool.thread_read({ thread: "self", limit: 2, cursor: "t1.x" }))
out.unknown = await j(tool.thread_list({ bogus: 1 }))
const fixed = out.unknown?.error?.details?.corrected_call
out.fixed = fixed === undefined ? null : await j(eval(fixed))
print("QA15073=" + JSON.stringify(out))
`
const CALL = { name: "eval", args: { language: "js", summary: "QA: thread tools under familiar argument names", code: CELL } }
const textOf = (message) =>
  typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => part?.text ?? "").join("")
      : ""
let fake
const choose = () => {
  const messages = fake?.requests.at(-1)?.messages ?? []
  const last = messages.at(-1)
  const lastUser = textOf([...messages].reverse().find((message) => message.role === "user"))
  if (last?.role !== "user") return { text: "done" }
  if (lastUser.includes("Run the familiar calls")) return { toolCalls: [CALL] }
  return { text: "PEER_OK" }
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
const client = await HostClient.connect(host.socket, "familiar-args")
const caller = await client.openSession({ cwd: scratch.cwd })
await client.promptAndSettle(caller.routingId, "Run the familiar calls.", { streamingBehavior: "followUp" })

let out
for (const message of await client.messages(caller.routingId)) {
  const text = JSON.stringify(message.content ?? null)
  const at = text.indexOf("QA15073=")
  if (at === -1) continue
  // The cell printed one JSON line; it arrives JSON-escaped inside the tool result's text.
  const line = JSON.parse(`"${text.slice(at + "QA15073=".length).split("\\n")[0]}"`)
  out = JSON.parse(line)
}
report.log(`cell_output=${JSON.stringify(out ?? null).slice(0, 4000)}`)
const names = (listing) => (listing?.threads ?? []).map((row) => row.name)
report.assert("cell-ran", out !== undefined, "the eval cell printed its QA15073 line")
report.assert(
  "thread_list-query-narrows",
  out?.query?.kind === "ok" && names(out.query).length === 1 && names(out.query)[0] === "qa-15073-peer",
  `names=${JSON.stringify(names(out?.query))}`,
)
report.assert(
  "thread_list-limit-cuts-and-counts",
  out?.limit?.kind === "ok" && out.limit.threads.length === 1 && out.limit.rows_omitted >= 1,
  `rows=${out?.limit?.threads?.length} omitted=${out?.limit?.rows_omitted}`,
)
report.assert("thread_send-text-is-message", out?.send?.kind === "ok", `send=${JSON.stringify(out?.send).slice(0, 300)}`)
report.assert(
  "thread_read-limit-and-tail-take-the-newest",
  out?.readLimit?.kind === "ok" &&
    out.readLimit.items.length <= 2 &&
    out?.readTail?.kind === "ok" &&
    out.readTail.items.length === out.readLimit.items.length,
  `limit=${out?.readLimit?.items?.length} tail=${out?.readTail?.items?.length}`,
)
report.assert(
  "thread_read-limit-with-cursor-refused",
  out?.readBoth?.kind === "error" && out.readBoth.error.code === "invalid_arguments",
  `readBoth=${JSON.stringify(out?.readBoth).slice(0, 300)}`,
)
report.assert(
  "unknown-field-refused-with-a-runnable-corrected-call",
  out?.unknown?.error?.code === "invalid_arguments" &&
    out.unknown.error.details.field === "bogus" &&
    out.unknown.error.next_action.includes(out.unknown.error.details.corrected_call) &&
    out?.fixed?.kind === "ok",
  `unknown=${JSON.stringify(out?.unknown?.error).slice(0, 500)} fixed=${out?.fixed?.kind}`,
)
const shardSockets = stopOwnedShardHosts(scratch.dir)
await cleanupAllAndWait()
const lateShards = stopOwnedShardHosts(scratch.dir)
const shardSurvivors = [...shardSockets, ...lateShards].flatMap((socket) => pgrepPids(socket))
report.assert("shard-hosts-stopped", shardSurvivors.length === 0, `survivor_pids=${JSON.stringify(shardSurvivors)}`)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
