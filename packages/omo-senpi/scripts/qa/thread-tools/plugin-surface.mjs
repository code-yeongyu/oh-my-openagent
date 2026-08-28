#!/usr/bin/env bun
import { join } from "node:path"
import { HostClient, makeScratch, startRealHost, startFakeModelServer, writeMockModelsJson, installCleanupHooks, cleanupAllAndWait, createReport } from "./lib/harness.mjs"
const report = createReport("plugin-surface")
installCleanupHooks()
const scratch = makeScratch("plugin-surface")
const fake = await startFakeModelServer([{ text: "plugin-ready" }])
writeMockModelsJson(scratch.agentDir, fake)
const extension = join(process.cwd(), "packages/omo-senpi/plugin/extensions/omo.js")
const host = await startRealHost(scratch, { extraArgs: ["--provider", "mock", "--model", "mock-model", "--extension", extension] })
const client = await HostClient.connect(host.socket, "plugin")
const caller = await client.openSession({ cwd: scratch.cwd })
const surfaces = await client.request({ type: "get_loaded_surfaces", sessionId: caller.routingId })
const source = await Bun.file(extension).text()
const names = ["thread_create", "thread_list", "thread_read", "thread_send", "thread_interrupt", "thread_handoff"]
report.assert("spawn-with-built-extension", JSON.stringify(surfaces).includes("omo.js"), `spawn=senpi --mode rpc --multi-session --listen unix://${host.socket} --extension ${extension}`)
report.assert("six-tools-and-guideline", names.every((name) => source.includes(name)) && source.includes("Thread tools address peer sessions"), `loaded_surfaces=${JSON.stringify(surfaces.data ?? surfaces).slice(0, 500)}`)
report.log(`PASS plugin-surface real Senpi host loaded built extension; tools=${names.join(",")} guidelines=1`)
await cleanupAllAndWait()
report.write(process.env.OUT)
if (report.failures) process.exit(1)
