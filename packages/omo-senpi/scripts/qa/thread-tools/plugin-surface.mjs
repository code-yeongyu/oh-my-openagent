#!/usr/bin/env bun
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { HostClient, makeScratch, startRealHost, startFakeModelServer, writeMockModelsJson, installCleanupHooks, cleanupAllAndWait, createReport, flag, pgrepPids, stopOwnedShardHosts, verifyCleanup } from "./lib/harness.mjs"
const report = createReport("plugin-surface")
installCleanupHooks()
const scratch = makeScratch("plugin-surface")
const fake = await startFakeModelServer([{ toolCalls: [{ name: "tool_search", args: { query: "threads" } }] }, { toolCalls: [{ name: "thread_list", args: { all_scope: true } }] }, { text: "plugin-ready" }])
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
const host = await startRealHost(scratch, { socketPath, extraArgs: ["--provider", "mock", "--model", "mock-model", "--extension", extension] })
report.log(`host-stderr=${host.stderrText().split("\\n").filter((line) => line.includes("thread") || line.includes("extension")).join("\\n")}`)
const client = await HostClient.connect(host.socket, "plugin")
const caller = await client.openSession({ cwd: scratch.cwd })
const surfaces = await client.request({ type: "get_loaded_surfaces", sessionId: caller.routingId })
// No settle delay before the first prompt: the engine orders it itself. `bindExtensions` holds the
// session-work barrier while session_start runs, and `prompt()` waits for that barrier to settle.
await client.promptAndSettle(caller.routingId, "Call tool_search for threads, then call thread_list.", { streamingBehavior: "followUp" })
await client.promptAndSettle(caller.routingId, "Call thread_list now.", { streamingBehavior: "followUp" })
const messages = await client.messages(caller.routingId)
const transcript = JSON.stringify(messages)
// The fake model numbers tool calls per RESPONSE, so the tool_search call and the thread_list call
// are both `call_1`. Pair each result with the call that produced it by name instead: the
// assistant tool call that preceded it, or the `toolName` the host records on the result.
const callNames = new Map()
const threadListCalls = []
let toolResult
for (const message of messages) {
  if (message.role === "assistant" && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type !== "toolCall") continue
      callNames.set(part.id, part.name)
      if (part.name === "thread_list") threadListCalls.push(part.id)
    }
    continue
  }
  if (message.role !== "tool" && message.role !== "toolResult") continue
  const callId = message.toolCallId ?? message.tool_call_id
  if ((message.toolName ?? callNames.get(callId)) === "thread_list") toolResult = message
}
const resultText = typeof toolResult?.content === "string" ? toolResult.content : JSON.stringify(toolResult?.content ?? toolResult ?? {})
const resultPayload = typeof toolResult?.content === "string" ? toolResult.content : Array.isArray(toolResult?.content) ? toolResult.content.map((part) => part?.text ?? "").join("") : resultText
let parsedResult
try { parsedResult = JSON.parse(resultPayload) } catch { parsedResult = undefined }
report.assert("spawn-with-built-extension", JSON.stringify(surfaces).includes("omo.js"), `spawn=senpi --mode rpc --multi-session --listen unix://${host.socket} --extension ${extension}`)
report.assert("agent-called-thread-list", threadListCalls.length > 0, `thread_list_calls=${JSON.stringify(threadListCalls)} transcript=${transcript.slice(0, 1000)}`)

// The delivery check is unconditional: a wrong or missing `thread_list` result is a FAIL. The
// real result arrives on every run, so there is no host limitation left to skip for.
const deliveryOk = toolResult !== undefined && parsedResult?.kind === "ok" && Array.isArray(parsedResult.threads) && parsedResult.scope === "all"
report.assert("thread-list-tool-result", deliveryOk, `tool_result=${resultText}`)
await cleanupAllAndWait()
// The plugin's task component pre-warms a detached `p-*` shard for this session; stop it and prove
// it gone, so a green run leaves nothing behind for the engine's idle window.
const shardSockets = stopOwnedShardHosts(scratch.dir)
const shardSurvivors = shardSockets.flatMap((socket) => pgrepPids(socket))
report.assert("shard-hosts-stopped", shardSurvivors.length === 0, `shards=${JSON.stringify(shardSockets)} survivor_pids=${JSON.stringify(shardSurvivors)}`)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
// Match the other lanes: run-all passes the out path as `--out <file>`, and it parses that file
// for SKIP lines to build the summary's skipped count. Reading process.env.OUT instead left the
// file unwritten under run-all, so a real SKIP read as skipped=0.
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
