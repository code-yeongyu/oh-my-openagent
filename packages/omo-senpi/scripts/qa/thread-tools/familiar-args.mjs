#!/usr/bin/env bun
// #15073 on a REAL rpc host with the built omo extension: a session's js cell calls the thread tools with the argument
// names the fleet census found agents predicting (thread_read limit/tail, thread_list query/limit), and with a field no
// tool takes. Every familiar name must do what it says; the unknown field must be refused with a corrected call that the
// cell can run as given; a send without its required message (text instead) must be refused naming message.
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
const j = async (p) => { try { const r = await p; try { return JSON.parse(r.text) } catch { return { raw: String(r.text).slice(0, 800) } } } catch (e) { return { threw: String(e).slice(0, 800) } } }
const outcome = (v) => v.kind === "ok" ? "ok" : (v.error?.code ?? v.threw ?? v.raw ?? "?")
const peer = await j(tool.thread_create({ name: "qa-15073-peer" }))
const thread = peer.thread
const query = await j(tool.thread_list({ query: "QA-15073" }))
const limit = await j(tool.thread_list({ limit: 1 }))
const send = await j(tool.thread_send({ thread, text: "QA-15073-TEXT reply with exactly PEER_OK." }))
const sendShown = String(send.threw ?? JSON.stringify(send)).split("Received arguments")[0]
const sendNamesMessage = sendShown.includes("required") && sendShown.includes("message")
const readLimit = await j(tool.thread_read({ thread: "self", limit: 2 }))
const readTail = await j(tool.thread_read({ thread: "self", tail: 2 }))
const readBoth = await j(tool.thread_read({ thread: "self", limit: 2, cursor: "t1.x" }))
const unknown = await j(tool.thread_list({ bogus: 1 }))
const corrected = unknown.error?.details?.corrected_call
const fixed = corrected === undefined ? { kind: "none" } : await j(eval(corrected))
print("QA15073=" + JSON.stringify({
  create: outcome(peer),
  query: outcome(query), queryNames: (query.threads ?? []).map((row) => row.name),
  limit: outcome(limit), limitRows: limit.threads?.length, limitOmitted: limit.rows_omitted,
  send: send.threw !== undefined ? "refused_by_host" : outcome(send), sendNamesMessage, sendShown: sendShown.split(String.fromCharCode(10)).join(" ").slice(0, 160),
  readLimit: outcome(readLimit), readLimitN: readLimit.items?.length,
  readTail: outcome(readTail), readTailN: readTail.items?.length,
  readBoth: outcome(readBoth),
  unknown: outcome(unknown), unknownField: unknown.error?.details?.field, corrected,
  nextShowsCorrected: corrected !== undefined && String(unknown.error?.next_action).includes(corrected),
  fixed: outcome(fixed),
}))
`
const CALL = {
  name: "eval",
  args: { language: "js", summary: "QA: thread tools under familiar argument names", code: CELL },
}
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

// The cell's printed line sits in whichever string field of the tool result carries the cell output.
const strings = (value) =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value !== null && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : []
let out
for (const message of await client.messages(caller.routingId)) {
  if (message.role !== "toolResult" && message.role !== "tool") continue
  for (const text of strings(message)) {
    const at = text.indexOf("QA15073=")
    if (at === -1) continue
    const line = text.slice(at + "QA15073=".length).split("\n")[0]
    try {
      out = JSON.parse(line)
    } catch (error) {
      report.log(`unparsed_cell_line=${line.slice(0, 2000)} error=${String(error)}`)
    }
  }
}
report.log(`cell_output=${JSON.stringify(out ?? null).slice(0, 4000)}`)
report.assert("cell-ran", out !== undefined, "the eval cell printed its QA15073 line")
report.assert("thread_create-ok", out?.create === "ok", `create=${out?.create}`)
report.assert(
  "thread_list-query-narrows",
  out?.query === "ok" && JSON.stringify(out.queryNames) === JSON.stringify(["qa-15073-peer"]),
  `query=${out?.query} names=${JSON.stringify(out?.queryNames)}`,
)
report.assert(
  "thread_list-limit-cuts-and-counts",
  out?.limit === "ok" && out.limitRows === 1 && out.limitOmitted >= 1,
  `limit=${out?.limit} rows=${out?.limitRows} omitted=${out?.limitOmitted}`,
)
report.assert(
  "thread_send-without-message-refused-naming-it",
  out?.send !== undefined && out.send !== "ok" && out.sendNamesMessage === true,
  `send=${out?.send} shown=${out?.sendShown}`,
)
report.assert(
  "thread_read-limit-and-tail-take-the-newest",
  out?.readLimit === "ok" &&
    out.readLimitN >= 1 &&
    out.readLimitN <= 2 &&
    out?.readTail === "ok" &&
    out.readTailN === out.readLimitN,
  `limit=${out?.readLimit}/${out?.readLimitN} tail=${out?.readTail}/${out?.readTailN}`,
)
report.assert(
  "thread_read-limit-with-cursor-refused",
  out?.readBoth === "invalid_arguments",
  `readBoth=${out?.readBoth}`,
)
report.assert(
  "unknown-field-refused-with-a-runnable-corrected-call",
  out?.unknown === "invalid_arguments" &&
    out.unknownField === "bogus" &&
    out.nextShowsCorrected === true &&
    out?.fixed === "ok",
  `unknown=${out?.unknown} field=${out?.unknownField} corrected=${out?.corrected} fixed=${out?.fixed}`,
)
const shardSockets = stopOwnedShardHosts(scratch.dir)
await cleanupAllAndWait()
const lateShards = stopOwnedShardHosts(scratch.dir)
const shardSurvivors = [...shardSockets, ...lateShards].flatMap((socket) => pgrepPids(socket))
report.assert("shard-hosts-stopped", shardSurvivors.length === 0, `survivor_pids=${JSON.stringify(shardSurvivors)}`)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
