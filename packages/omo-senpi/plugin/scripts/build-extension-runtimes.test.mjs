import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createGatewayStore, gatewayStoreWorkerUrl } from "../../src/components/thread/gateway/store.ts"

import { checkExtensionCurrent } from "./build-extension.mjs"
import { SDK_RUNTIME_FILES } from "./runtime-files.mjs"
import {
  difference,
  normalizeModulePath,
  STATIC_SET_DEFINITION,
  STATIC_SET_PATH,
  staticModuleSet,
  staticSetDefinition,
  staticSetPath,
} from "./omo-sdk-static-set.mjs"
import { createBuildFixture, BUILD_HOOK_OUTER_BOUND_MS } from "./build-extension.test-support.mjs"

// The runtimes the built extension ships beside omo.js: the gateway store worker sidecar and the
// thread SDK that runs on it. One build is shared by the whole file.
const fixture = createBuildFixture()
const { perTestRoots, sharedOutputs, mutableOutputs } = fixture

setDefaultTimeout(90_000)

/**
 * stderr less the one warning node 24.0.x prints when a module imports `node:sqlite` (later 24.x
 * releases print none, and the package supports node >= 24.0.0). Everything else stays, so any
 * other output still fails the round trip.
 */
function unexpectedStderr(stderr) {
  const lines = stderr.split("\n")
  const kept = []
  for (let index = 0; index < lines.length; index++) {
    if (/ExperimentalWarning: SQLite is an experimental feature/.test(lines[index])) {
      if (/^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/.test(lines[index + 1] ?? ""))
        index++
      continue
    }
    kept.push(lines[index])
  }
  return kept.join("\n")
}

// #13965: the cold builds run once as setup, bounded by their progress and CPU use, not this hook's outer bound.
beforeAll(() => fixture.warmBuilds({ reproduction: false }), BUILD_HOOK_OUTER_BOUND_MS)
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
      expect({ journal, referenced, transactions: typeof stats.transactions }).toEqual({
        journal: "wal",
        referenced: false,
        transactions: "number",
      })
    } finally {
      await store.dispose()
    }
  })

  test("#given the built sidecar #when plain node starts it as a worker thread #then it answers init and stats", async () => {
    // given
    const outputs = await sharedOutputs()
    const agentDir = await mkdtemp(join(tmpdir(), "omo-gateway-node-worker-"))
    perTestRoots.push(agentDir)
    const config = {
      agent_dir: agentDir,
      busy_timeout_ms: 5000,
      instance_id: "built-worker-probe",
      runtime_instance: null,
      legacy_mailbox_directories: [],
      test_hooks: {},
    }
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    const exitCode = await new Promise((resolve) => child.once("close", resolve))

    // then
    expect({ exitCode, stderr: unexpectedStderr(stderr) }).toEqual({ exitCode: 0, stderr: "" })
    const replies = JSON.parse(stdout.trim())
    expect(replies.map((reply) => [reply.id, reply.ok])).toEqual([
      [1, true],
      [2, true],
    ])
    expect(replies[0].value.self.instance_id).toBe("built-worker-probe")
  })

  test("#given the built extension without its store worker sidecar #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    await rm(outputs.gatewayStoreWorkerOutputPath)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({
      ok: false,
      reason: "missing-output",
      output: outputs.gatewayStoreWorkerOutputPath,
    })
  })
})

// The node packages a shipped SDK runtime inlines, by name (LEAD ruling on the P1b regression that widened the thread SDK
// runtime from 1 package to 29): a new import that widens either bundle fails here naming the package.
const inlinedPackages = (inputs) =>
  [...new Set(inputs.flatMap((input) => /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input)?.[1] ?? []))].sort()

describe("shipped SDK runtimes inline a pinned set of packages", () => {
  test("#given the thread SDK runtime build #when its inputs are read #then the inlined packages are exactly the pinned set", async () => {
    expect(inlinedPackages((await sharedOutputs()).threadSdkInputs)).toEqual(["typebox"])
  })

  test("#given the omo SDK runtime build #when its inputs are read #then the inlined packages are exactly the pinned set", async () => {
    expect(inlinedPackages((await sharedOutputs()).omoSdkInputs)).toEqual(["jsonc-parser", "typebox", "zod"])
  })
})

// The provisioned SDK root runtime's cold-import decision (design lane and owner, P1b #14950): the call table, the thread
// contracts and the thread core load on first use and the file may not grow. Raising the ceiling or adding a static path
// reopens that decision. Since slice P1c (#15031) the thread core ships in its own file with its own ceiling: each is the
// file's measured size (amendment 28), so thread slices move the thread file's number, not the root's.
const OMO_SDK_RUNTIME_BYTES = 607_566
const OMO_SDK_THREADS_RUNTIME_BYTES = 532_813
const DEFERRED = ["omo-sdk/contract/calls.ts", "components/thread/contracts/", "components/thread/sdk-core/index.ts"]

// What ships and runs at import (design lane ruling of record): the built runtime's inputs that keep bytes in its output,
// reached from the entry by static edges only, plus the node builtins a kept module imports, named the same in every
// install layout. plugin/scripts/omo-sdk-static-set.mjs computes it; `bun <that file> --write` rewrites the list, and a
// slice that changes the set edits the list in the same commit, where its reviewer sees it.
const { definition: STATIC_SET_FILE_DEFINITION, modules: STATIC_SET } = JSON.parse(
  readFileSync(STATIC_SET_PATH, "utf8"),
)

describe("the provisioned SDK root runtime's cold import (P1b decision)", () => {
  test("#given the built runtime #then it is no larger than the decided ceiling", async () => {
    const bytes = Bun.file((await sharedOutputs()).omoSdkOutputPath).size
    expect(
      bytes <= OMO_SDK_RUNTIME_BYTES ||
        `the omo SDK runtime is ${bytes} bytes, over its ceiling of ${OMO_SDK_RUNTIME_BYTES}: growth reopens the P1b cold-import decision (#14950); split the thread core into its own runtime file first (the next SDK slice). A size is valid only in a tree with submodules initialised and a frozen install from the head's own bun.lock, built with the pinned bun.`,
    ).toBe(true)
  })

  test("#given the runtime entry #then the modules that ship and run at import (kept bytes, static edges) are exactly the committed list", async () => {
    const { set, schemaUsers } = await staticModuleSet()
    expect(STATIC_SET_FILE_DEFINITION).toBe(STATIC_SET_DEFINITION)
    expect({ ...difference(set, STATIC_SET), schemaLibraryImporters: schemaUsers }).toEqual({
      added: [],
      removed: [],
      schemaLibraryImporters: schemaUsers,
    })
  })

  // Control: one static telemetry import added to the runtime entry is named by the comparison.
  test("#given an entry that adds one static telemetry import to the runtime entry #then the comparison names the telemetry modules it adds", async () => {
    const dir = await mkdtemp(
      join(fileURLToPath(new URL("../..", import.meta.url)), "src", "extension", ".static-control-"),
    )
    perTestRoots.push(dir)
    await writeFile(
      join(dir, "entry.ts"),
      `export * from "../omo-sdk"\nimport * as telemetry from "@oh-my-opencode/telemetry-core/otlp"\nexport const probe = Object.keys(telemetry)\n`,
    )
    const { set } = await staticModuleSet(join(dir, "entry.ts"))
    const { added } = difference(set, STATIC_SET)
    expect(added.filter((path) => path.startsWith("packages/telemetry-core/")).length).toBeGreaterThan(0)
  })

  test("#given the runtime entry #then the deferred modules are on no static import path", async () => {
    const { reached } = await staticModuleSet()
    expect(reached.filter((path) => DEFERRED.some((part) => path.includes(part)))).toEqual([])
  })
})

describe("the SDK root's thread runtime file (P1c, #15031)", () => {
  const threadsRow = SDK_RUNTIME_FILES.find((row) => row.name === "threads")
  const { definition, modules } = JSON.parse(readFileSync(staticSetPath(threadsRow), "utf8"))

  test("#given the built thread runtime file #then it is no larger than its own ceiling", async () => {
    const bytes = Bun.file(join(dirname((await sharedOutputs()).omoSdkOutputPath), "threads.js")).size
    expect(
      bytes <= OMO_SDK_THREADS_RUNTIME_BYTES ||
        `the SDK thread runtime is ${bytes} bytes, over its ceiling of ${OMO_SDK_THREADS_RUNTIME_BYTES}: a thread slice pins the file's new measured size with its metafile and cold-import numbers (amendment 28). A size is valid only in a tree with submodules initialised and a frozen install from the head's own bun.lock, built with the pinned bun.`,
    ).toBe(true)
  })

  test("#given the root's build #then no module of the thread core is among its inputs, and its logger-port helper is", async () => {
    const { omoSdkInputs } = await sharedOutputs()
    expect(omoSdkInputs.filter((path) => path.includes("components/thread/sdk-core/"))).toEqual([])
    expect(omoSdkInputs.filter((path) => /components\/thread\/.*text[^/]*\.ts$/.test(path))).toEqual([])
    expect(omoSdkInputs.some((path) => path.endsWith("components/omo-sdk/unexpected-port.ts"))).toBe(true)
  })

  test("#given the thread file's build #then the thread core is among its inputs and the root's entry is not", async () => {
    const { threads } = (await sharedOutputs()).sdkRuntimeInputs
    expect(threads.some((path) => path.includes("components/thread/sdk-core/"))).toBe(true)
    expect(threads.some((path) => path.endsWith("src/extension/omo-sdk.ts"))).toBe(false)
  })

  test("#given the shipped thread runtime file #then it exports exactly what the root takes, as functions and plain data", async () => {
    const { createThreadCore, fail, threadToolParamSchemas, ...rest } = await import("../runtime/omo-sdk/threads.js")
    expect(Object.keys(rest)).toEqual([])
    expect([typeof createThreadCore, typeof fail]).toEqual(["function", "function"])
    expect(Object.getPrototypeOf(threadToolParamSchemas)).toBe(Object.prototype)
  })

  test("#given the thread runtime entry #then the modules it ships (kept bytes, static edges) are exactly its committed list", async () => {
    const { set } = await staticModuleSet(undefined, { row: threadsRow })
    expect(definition).toBe(staticSetDefinition(threadsRow))
    expect(difference(set, modules)).toEqual({ added: [], removed: [] })
  })
})

describe("the static set's module names", () => {
  test("#given one module reached through a node_modules link, a copied package and its real path #then all three have one name", async () => {
    const root = await mkdtemp(join(tmpdir(), "static-set-names-"))
    perTestRoots.push(root)
    await mkdir(join(root, "packages", "core", "src"), { recursive: true })
    await writeFile(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@fixture/core" }))
    await writeFile(join(root, "packages", "core", "src", "a.ts"), "export const a = 1\n")
    await mkdir(join(root, "node_modules", "@fixture"), { recursive: true })
    await symlink(join(root, "packages", "core"), join(root, "node_modules", "@fixture", "core"))
    await mkdir(join(root, "copy", "node_modules", "@fixture", "core", "src"), { recursive: true })
    await writeFile(join(root, "copy", "node_modules", "@fixture", "core", "src", "a.ts"), "export const a = 1\n")
    await mkdir(join(root, "node_modules", ".bun", "zod@4.6.7", "node_modules", "zod"), { recursive: true })
    await writeFile(join(root, "node_modules", ".bun", "zod@4.6.7", "node_modules", "zod", "index.js"), "\n")
    const options = { repoRoot: root, base: root }
    expect([
      normalizeModulePath("packages/core/src/a.ts", options),
      normalizeModulePath("node_modules/@fixture/core/src/a.ts", options),
      normalizeModulePath("copy/node_modules/@fixture/core/src/a.ts", options),
      normalizeModulePath("node_modules/.bun/zod@4.6.7/node_modules/zod/index.js", options),
    ]).toEqual([
      "packages/core/src/a.ts",
      "packages/core/src/a.ts",
      "packages/core/src/a.ts",
      "node_modules/zod/index.js",
    ])
  })
})

describe("thread SDK runtime", () => {
  test("#given the thread SDK build #when its inputs and exports are inspected #then it is a standalone entry that inlines no package but the contracts' typebox", async () => {
    const outputs = await sharedOutputs()
    expect(outputs.threadSdkInputs.some((input) => input.endsWith("src/extension/thread-sdk.ts"))).toBe(true)
    expect(
      outputs.threadSdkInputs.filter(
        (input) => input.includes("node_modules/") && !input.includes("/node_modules/typebox/"),
      ),
    ).toEqual([])
    const sdk = await import(outputs.threadSdkOutputPath)
    expect(Object.keys(sdk).sort()).toEqual(["createThreadSdk", "readSessionFacts"])
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
    // A thread no host serves, known from its session file: a send to it is stored queued_offline by the worker.
    const sessionsDir = join(agentDir, "sessions", "--probe--")
    await mkdir(sessionsDir, { recursive: true })
    await writeFile(
      join(sessionsDir, "epoch_dur-off.jsonl"),
      `${JSON.stringify({ type: "session", id: "dur-off", cwd: process.cwd(), timestamp: "2026-10-02T00:00:00Z" })}\n`,
    )
    // The account surface is injected, so the outcome never depends on whether this host runs a device service: one
    // account whose lookup answered and lists no such thread (not_found), one whose lookup never answered (host_unavailable).
    const probe = [
      `const { createThreadSdk } = await import(${JSON.stringify(pathToFileURL(join(plugin, "runtime", "thread-sdk", "sdk.js")).href)})`,
      "const account = (listing) => ({",
      "  client: {",
      "    service: { status: async () => ({ kind: 'ok', value: { state: 'connected', since_ms: 0, device: { id: 'a', name: 'a' }, origin_configured: true, enabled: true, service_version: 'probe' } }) },",
      "    devices: { list: async () => ({ kind: 'ok', value: [",
      "      { id: 'a', name: 'a', kind: 'device', platform: 'linux', online: true, last_seen_ms: null, self: true },",
      "      { id: 'b', name: 'b', kind: 'device', platform: 'linux', online: true, last_seen_ms: null },",
      "    ] }) },",
      "  },",
      "  sessions: { listing, sessions: async () => (await listing()).rows, close: async () => {} },",
      "})",
      "const other = { device: 'b', session_id: 'rk-other', durable_id: 'dur-other', title: 'other', project: '/w', path: '/w', state: 'idle', updated_ms: 1 }",
      "const answered = account(async () => ({ rows: [other], incomplete: [] }))",
      "const unanswered = account(async () => { throw new Error('lookup_timeout') })",
      `const open = (remote) => createThreadSdk({ agentDir: ${JSON.stringify(agentDir)}, cwd: process.cwd(), uid: 501, user: "probe", engineStatusAll: async () => undefined, remote })`,
      "const sdk = open(answered)",
      "const sent = await sdk.send({ thread: 'dur-off', text: 'ping', all_scope: true })",
      "const missing = await sdk.send({ thread: 'no-such-thread', text: 'ping', all_scope: true })",
      "await sdk.dispose()",
      "const silent = open(unanswered)",
      "const unreached = await silent.send({ thread: 'no-such-thread', text: 'ping', all_scope: true })",
      "await silent.dispose()",
      "const code = (result) => result.kind === 'error' ? result.error.code : result.kind",
      "console.log(JSON.stringify({ sent: sent.kind === 'ok' ? sent.delivery.kind : sent.error.code, missing: code(missing), unreached: code(unreached), principal: sdk.principal }))",
    ].join("\n")

    // when: a connector script run inline, whose `--input-type` the store worker must not inherit
    const child = spawn("node", ["--input-type=module", "-e", probe], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    const exitCode = await new Promise((resolve) => child.once("close", resolve))

    // then
    expect({ exitCode, stderr: unexpectedStderr(stderr) }).toEqual({ exitCode: 0, stderr: "" })
    expect(JSON.parse(stdout.trim())).toEqual({
      sent: "queued_offline",
      missing: "not_found",
      unreached: "host_unavailable",
      principal: "cli:501",
    })
  })

  test("#given the built extension without the thread SDK #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    await rm(outputs.threadSdkOutputPath)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({
      ok: false,
      reason: "missing-output",
      output: outputs.threadSdkOutputPath,
    })
  })
})

describe("omo SDK runtime", () => {
  test("#given the built omo SDK #when plain node imports it #then it exports createOmoSdk and answers typed reads with no engine", async () => {
    // given: a signed-out store port and a state dir no device service listens on
    const outputs = await sharedOutputs()
    expect(outputs.omoSdkInputs.some((input) => input.endsWith("src/extension/omo-sdk.ts"))).toBe(true)
    const home = await mkdtemp(join(tmpdir(), "omo-sdk-built-"))
    perTestRoots.push(home)
    const probe = [
      `const sdk = await import(${JSON.stringify(pathToFileURL(outputs.omoSdkOutputPath).href)})`,
      `const omo = sdk.createOmoSdk({ env: { HOME: ${JSON.stringify(home)}, OMO_DEVICE_SERVICE_STATE_DIR: ${JSON.stringify(join(home, "state"))} }, cwd: ${JSON.stringify(home)}, home: ${JSON.stringify(home)}, ports: { desktopLaunch: () => false, credentialStore: { read: async () => null } } })`,
      "const [devices, status, config] = [await omo.devices.list(), await omo.deviceService.status(), await omo.config.status()]",
      "console.log(JSON.stringify({ exports: Object.keys(sdk).sort(), devices: devices.kind === 'error' ? devices.error.code : devices.kind, status: status.kind === 'ok' ? status.value.state : status.error.code, config: config.kind }))",
    ].join("\n")

    // when
    const child = spawn("node", ["--input-type=module", "-e", probe], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    const exitCode = await new Promise((resolve) => child.once("close", resolve))

    // then
    expect({ exitCode, stderr: unexpectedStderr(stderr) }).toEqual({ exitCode: 0, stderr: "" })
    expect(JSON.parse(stdout.trim())).toEqual({
      exports: ["SDK_VERSION", "createOmoSdk"],
      devices: "signed_out",
      status: "not_running",
      config: "ok",
    })
  })

  // #14950 QA: the shipped root's store started its worker at runtime/omo-sdk/store-worker.ts, which only the source tree
  // has, so every store-backed call answered internal_error from the built file while the source answered losslessly.
  test("#given the built omo SDK two levels below the extensions directory #when plain node calls a store-backed member #then the store runs on the emitted worker sidecar", async () => {
    // given: the plugin layout, runtime/omo-sdk/sdk.js beside extensions/gateway-store-worker.mjs
    const outputs = await sharedOutputs()
    const plugin = await mkdtemp(join(tmpdir(), "omo-sdk-built-layout-"))
    perTestRoots.push(plugin)
    await mkdir(join(plugin, "runtime", "omo-sdk"), { recursive: true })
    await mkdir(join(plugin, "extensions"), { recursive: true })
    await cp(outputs.omoSdkOutputPath, join(plugin, "runtime", "omo-sdk", "sdk.js"))
    await cp(outputs.gatewayStoreWorkerOutputPath, join(plugin, "extensions", "gateway-store-worker.mjs"))
    await cp(join(dirname(outputs.omoSdkOutputPath), "threads.js"), join(plugin, "runtime", "omo-sdk", "threads.js"))
    await cp(fileURLToPath(new URL("../package.json", import.meta.url)), join(plugin, "package.json"))
    const probe = [
      `const { createOmoSdk } = await import(${JSON.stringify(pathToFileURL(join(plugin, "runtime", "omo-sdk", "sdk.js")).href)})`,
      `const root = createOmoSdk({ env: { HOME: ${JSON.stringify(plugin)} }, cwd: ${JSON.stringify(plugin)}, home: ${JSON.stringify(plugin)}, agentDir: ${JSON.stringify(join(plugin, "agent"))} })`,
      "const called = await root.threads.extensions.call({ name: 'probe.ext', op: 'ping', args: {} })",
      "await root.dispose()",
      "console.log(JSON.stringify(called.kind === 'error' ? { code: called.error.code, refusal: called.error.details?.code } : { kind: called.kind }))",
    ].join("\n")

    // when
    const child = spawn("node", ["--input-type=module", "-e", probe], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    const exitCode = await new Promise((resolve) => child.once("close", resolve))

    // then: the store answered the unknown extension itself, losslessly, as it does from source
    expect({ exitCode, stderr: unexpectedStderr(stderr) }).toEqual({ exitCode: 0, stderr: "" })
    expect(JSON.parse(stdout.trim())).toEqual({ code: "not_found", refusal: "extension_unknown_name" })
  })

  // Slice P1c (#15031): the thread core ships in its own file beside the root, resolved through the plugin manifest's
  // import map, so a source-layout test proves nothing about it; this one runs the two shipped files.
  for (const runtime of ["node", "bun"])
    test(`#given the two built SDK files in a plugin layout #when ${runtime} runs a script #then an account call needs no thread file and a thread call loads it or refuses`, async () => {
      const outputs = await sharedOutputs()
      const threadsOutputPath = join(dirname(outputs.omoSdkOutputPath), "threads.js")
      const plugin = await mkdtemp(join(tmpdir(), "omo-sdk-split-layout-"))
      perTestRoots.push(plugin)
      await mkdir(join(plugin, "runtime", "omo-sdk"), { recursive: true })
      await cp(outputs.omoSdkOutputPath, join(plugin, "runtime", "omo-sdk", "sdk.js"))
      await cp(threadsOutputPath, join(plugin, "runtime", "omo-sdk", "threads.js"))
      await cp(fileURLToPath(new URL("../package.json", import.meta.url)), join(plugin, "package.json"))
      await mkdir(join(plugin, "extensions"), { recursive: true })
      await cp(outputs.gatewayStoreWorkerOutputPath, join(plugin, "extensions", "gateway-store-worker.mjs"))
      const run = async (withThreadsFile) => {
        if (!withThreadsFile) await rm(join(plugin, "runtime", "omo-sdk", "threads.js"), { force: true })
        const probe = [
          `const { createOmoSdk } = await import(${JSON.stringify(pathToFileURL(join(plugin, "runtime", "omo-sdk", "sdk.js")).href)})`,
          `const root = createOmoSdk({ env: { HOME: ${JSON.stringify(plugin)} }, cwd: ${JSON.stringify(plugin)}, home: ${JSON.stringify(plugin)}, agentDir: ${JSON.stringify(join(plugin, "agent"))}, ports: { desktopLaunch: () => false, credentialStore: { read: async () => null } } })`,
          "const config = await root.config.status()",
          "const sent = await root.threads.list({})",
          "await root.dispose()",
          "console.log(JSON.stringify({ config: config.kind, thread: sent.kind === 'error' ? { code: sent.error.code, reason: sent.error.details?.reason ?? null } : sent.kind }))",
        ].join("\n")
        const child = spawn(runtime, runtime === "node" ? ["--input-type=module", "-e", probe] : ["-e", probe], {
          stdio: ["ignore", "pipe", "pipe"],
        })
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (chunk) => {
          stdout += chunk
        })
        child.stderr.on("data", (chunk) => {
          stderr += chunk
        })
        const exitCode = await new Promise((resolve) => child.once("close", resolve))
        expect({ exitCode, stderr: unexpectedStderr(stderr) }).toEqual({ exitCode: 0, stderr: "" })
        return JSON.parse(stdout.trim())
      }

      // With the file present the thread core answers for itself: no engine runs here, so it reports the host unavailable.
      expect(await run(true)).toEqual({ config: "ok", thread: { code: "host_unavailable", reason: null } })
      expect(await run(false)).toEqual({
        config: "ok",
        thread: { code: "internal_error", reason: "runtime_file_unavailable" },
      })
    })

  test("#given the built extension without the thread runtime file #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    const threadsOutputPath = join(dirname(outputs.omoSdkOutputPath), "threads.js")
    await rm(threadsOutputPath)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({
      ok: false,
      reason: "missing-output",
      output: threadsOutputPath,
    })
  })

  test("#given the built extension without the omo SDK #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    await rm(outputs.omoSdkOutputPath)
    expect(await checkExtensionCurrent(outputs)).toMatchObject({
      ok: false,
      reason: "missing-output",
      output: outputs.omoSdkOutputPath,
    })
  })
})
