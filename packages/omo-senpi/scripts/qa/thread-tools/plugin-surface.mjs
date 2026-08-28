#!/usr/bin/env bun
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { HostClient, makeScratch, startRealHost, startFakeModelServer, writeMockModelsJson, installCleanupHooks, cleanupAllAndWait, createReport } from "./lib/harness.mjs"
const report = createReport("plugin-surface")
installCleanupHooks()
const scratch = makeScratch("plugin-surface")
const fake = await startFakeModelServer([{ toolCalls: [{ name: "thread_list", args: { all_scope: true } }] }, { text: "plugin-ready" }])
writeMockModelsJson(scratch.agentDir, fake)
const extension = join(process.cwd(), "packages/omo-senpi/plugin/extensions/omo.js")
const configAgent = join(scratch.dir, ".senpi", "agent")
mkdirSync(configAgent, { recursive: true })
await Bun.write(join(configAgent, "settings.json"), "{}")
await Bun.write(join(configAgent, "models.json"), await Bun.file(join(scratch.agentDir, "models.json")).text())
const socketPath = join(configAgent, "rpc", "rpc.sock")
delete scratch.env.SENPI_RPC_SOCKET
delete scratch.env.SENPI_CODING_AGENT_DIR
delete scratch.env.OMO_CODING_AGENT_DIR
delete scratch.env.CODING_AGENT_DIR
scratch.env.HOME = scratch.dir
const host = await startRealHost(scratch, { socketPath, extraArgs: ["--provider", "mock", "--model", "mock-model", "--extension", extension] })
const client = await HostClient.connect(host.socket, "plugin")
const caller = await client.openSession({ cwd: scratch.cwd })
const surfaces = await client.request({ type: "get_loaded_surfaces", sessionId: caller.routingId })
await client.promptAndSettle(caller.routingId, "Call thread_list now.", { streamingBehavior: "followUp" })
const messages = await client.messages(caller.routingId)
const toolCallText = JSON.stringify(messages.filter((message) => message.role === "assistant"))
report.assert("spawn-with-built-extension", JSON.stringify(surfaces).includes("omo.js"), `spawn=senpi --mode rpc --multi-session --listen unix://${host.socket} --extension ${extension}`)
report.assert("agent-called-thread-list", toolCallText.includes("thread_list"), `assistant_messages=${toolCallText.slice(0, 1000)}`)
report.log("PASS plugin-surface real Senpi host loaded built extension and target transcript contains a thread_list tool call")
await cleanupAllAndWait()
report.write(process.env.OUT)
if (report.failures) process.exit(1)
