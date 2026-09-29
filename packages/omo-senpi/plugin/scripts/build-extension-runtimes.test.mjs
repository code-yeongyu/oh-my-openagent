import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createGatewayStore, gatewayStoreWorkerUrl } from "../../src/components/thread/gateway/store.ts"

import { checkExtensionCurrent } from "./build-extension.mjs"
import { createBuildFixture } from "./build-extension.test-support.mjs"

// The runtimes the built extension ships beside omo.js: the gateway store worker sidecar and the
// thread SDK that runs on it. One build is shared by the whole file.
const fixture = createBuildFixture()
const { perTestRoots, sharedOutputs, mutableOutputs } = fixture

setDefaultTimeout(90_000)

afterEach(fixture.cleanupTest)
afterAll(fixture.cleanupFile)

describe("gateway store worker sidecar", () => {
  test("#given the built extension #when the store facade resolves its worker from the built omo.js location #then it starts the emitted sidecar and round-trips store operations", async () => {
    // given
    const outputs = await sharedOutputs()
    const agentDir = await mkdtemp(join(tmpdir(), "omo-gateway-built-worker-"))
    perTestRoots.push(agentDir)
    const builtModule = pathToFileURL(outputs.outputPath)
    const store = createGatewayStore({ agentDir, _test: { moduleUrl: builtModule } })

    // when
    try {
      const journal = await store.journalMode()
      const referenced = await store.isReferenced("no-such-session")
      const stats = await store.stats()

      // then
      expect(fileURLToPath(gatewayStoreWorkerUrl(builtModule))).toBe(outputs.gatewayStoreWorkerOutputPath)
      expect({ journal, referenced, transactions: typeof stats.transactions }).toEqual({ journal: "wal", referenced: false, transactions: "number" })
    } finally {
      await store.dispose()
    }
  })

  test("#given the built sidecar #when plain node starts it as a worker thread #then it answers init and stats", async () => {
    // given
    const outputs = await sharedOutputs()
    const agentDir = await mkdtemp(join(tmpdir(), "omo-gateway-node-worker-"))
    perTestRoots.push(agentDir)
    const config = { agent_dir: agentDir, busy_timeout_ms: 5000, instance_id: "built-worker-probe", runtime_instance: null, legacy_mailbox_directories: [], test_hooks: {} }
    const probe = [
      "const { Worker } = require('node:worker_threads')",
      `const worker = new Worker(${JSON.stringify(outputs.gatewayStoreWorkerOutputPath)})`,
      "const replies = []",
      "worker.on('error', (error) => { console.error(String(error)); process.exit(2) })",
      "worker.on('message', (message) => { if (message.type !== 'response') return; replies.push(message); if (replies.length === 2) { console.log(JSON.stringify(replies)); worker.terminate() } })",
      `worker.postMessage({ type: 'request', id: 1, op: 'init', args: { config: ${JSON.stringify(config)}, now: Date.now() } })`,
      "worker.postMessage({ type: 'request', id: 2, op: 'stats', args: null })",
    ].join("\n")

    // when
    const child = spawn("node", ["-e", probe], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const exitCode = await new Promise((resolve) => child.once("close", resolve))

    // then
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    const replies = JSON.parse(stdout.trim())
    expect(replies.map((reply) => [reply.id, reply.ok])).toEqual([[1, true], [2, true]])
    expect(replies[0].value.self.instance_id).toBe("built-worker-probe")
  })

  test("#given the built extension without its store worker sidecar #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    await rm(outputs.gatewayStoreWorkerOutputPath)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({ ok: false, reason: "missing-output", output: outputs.gatewayStoreWorkerOutputPath })
  })
})

describe("thread SDK runtime", () => {
  test("#given the thread SDK build #when its inputs and exports are inspected #then it is a standalone entry that inlines no package but the contracts' typebox", async () => {
    const outputs = await sharedOutputs()
    expect(outputs.threadSdkInputs.some(input => input.endsWith("src/extension/thread-sdk.ts"))).toBe(true)
    expect(outputs.threadSdkInputs.filter(input => input.includes("node_modules/") && !input.includes("/node_modules/typebox/"))).toEqual([])
    const sdk = await import(outputs.threadSdkOutputPath)
    expect(Object.keys(sdk).sort()).toEqual(["SDK_VERSION", "createThreadSdk"])
  })

  test("#given the built SDK two levels below the extensions directory #when plain node opens it #then the store runs on the emitted worker sidecar", async () => {
    // given: the plugin layout, runtime/thread-sdk/sdk.js beside extensions/gateway-store-worker.mjs
    const outputs = await sharedOutputs()
    const plugin = await mkdtemp(join(tmpdir(), "omo-thread-sdk-built-"))
    perTestRoots.push(plugin)
    await mkdir(join(plugin, "runtime", "thread-sdk"), { recursive: true })
    await mkdir(join(plugin, "extensions"), { recursive: true })
    await cp(outputs.threadSdkOutputPath, join(plugin, "runtime", "thread-sdk", "sdk.js"))
    await cp(outputs.gatewayStoreWorkerOutputPath, join(plugin, "extensions", "gateway-store-worker.mjs"))
    const agentDir = join(plugin, "agent")
    const probe = [
      `const { createThreadSdk } = await import(${JSON.stringify(pathToFileURL(join(plugin, "runtime", "thread-sdk", "sdk.js")).href)})`,
      `const sdk = createThreadSdk({ agentDir: ${JSON.stringify(agentDir)}, cwd: process.cwd(), uid: 501, user: "probe", engineStatusAll: async () => undefined })`,
      "const listed = await sdk.bindings({})",
      "const missing = await sdk.outbox({ binding_id: 'no-such-binding' })",
      "await sdk.dispose()",
      "console.log(JSON.stringify({ listed: listed.kind, bindings: listed.bindings, missing: missing.kind === 'error' ? missing.error.code : missing.kind, principal: sdk.principal }))",
    ].join("\n")

    // when: a connector script run inline, whose `--input-type` the store worker must not inherit
    const child = spawn("node", ["--input-type=module", "-e", probe], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const exitCode = await new Promise((resolve) => child.once("close", resolve))

    // then
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(JSON.parse(stdout.trim())).toEqual({ listed: "ok", bindings: [], missing: "not_found", principal: "cli:501" })
  })

  test("#given the built extension without the thread SDK #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    await rm(outputs.threadSdkOutputPath)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({ ok: false, reason: "missing-output", output: outputs.threadSdkOutputPath })
  })
})
