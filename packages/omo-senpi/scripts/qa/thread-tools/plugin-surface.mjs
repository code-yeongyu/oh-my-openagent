#!/usr/bin/env bun
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { HostClient, makeScratch, startRealHost, startFakeModelServer, writeMockModelsJson, installCleanupHooks, cleanupAllAndWait, createReport } from "./lib/harness.mjs"
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
await Bun.sleep(1500)
await client.promptAndSettle(caller.routingId, "Call tool_search for threads, then call thread_list.", { streamingBehavior: "followUp" })
await client.promptAndSettle(caller.routingId, "Call thread_list now.", { streamingBehavior: "followUp" })
const messages = await client.messages(caller.routingId)
const transcript = JSON.stringify(messages)
const toolCallText = transcript
const toolResult = messages.find((message) => (message.role === "tool" || message.role === "toolResult") && (message.toolCallId === "call_1" || message.tool_call_id === "call_1"))
const resultText = typeof toolResult?.content === "string" ? toolResult.content : JSON.stringify(toolResult?.content ?? toolResult ?? {})
const resultPayload = typeof toolResult?.content === "string" ? toolResult.content : Array.isArray(toolResult?.content) ? toolResult.content.map((part) => part?.text ?? "").join("") : resultText
let parsedResult
try { parsedResult = JSON.parse(resultPayload) } catch { parsedResult = undefined }
report.assert("spawn-with-built-extension", JSON.stringify(surfaces).includes("omo.js"), `spawn=senpi --mode rpc --multi-session --listen unix://${host.socket} --extension ${extension}`)
report.assert("agent-called-thread-list", toolCallText.includes("thread_list"), `transcript=${transcript.slice(0, 1000)}`)
report.assert("thread-list-tool-result", toolResult !== undefined && parsedResult?.kind === "ok" && Array.isArray(parsedResult.threads) && parsedResult.scope === "all", `tool_result=${resultText} model_requests=${JSON.stringify(fake.requests)}`)
report.log("PASS plugin-surface real Senpi host loaded built extension; transcript contains correlated call_1 thread_list result")
await cleanupAllAndWait()
report.write(process.env.OUT)
if (report.failures) process.exit(1)
