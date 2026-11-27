import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createGatewayStore, gatewayStoreWorkerUrl } from "../../src/components/thread/gateway/store.ts"

import { buildOmoSdkRuntime, omoSenpiBuildDefines } from "./build-extension-core.mjs"
import { checkExtensionCurrent } from "./build-extension.mjs"
import {
  difference,
  normalizeModulePath,
  STATIC_SET_DEFINITION,
  STATIC_SET_PATH,
  STATIC_SINCE_TRAIN_14,
  STATIC_SINCE_TRAIN_14_CHAIN,
  staticModuleSet,
  TRAIN_14_LISTING,
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

// Runs a probe as a plain node script (`--input-type=module -e`) or as a bun process, the way an eval cell runs one.
const runProbe = async (runtime, probe) => {
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
  return { exitCode, stderr: unexpectedStderr(stderr), stdout: stdout.trim() }
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
// reopens that decision; the split into a second runtime file is the next SDK slice's. The ceiling sits at the current
// size (owner's rule): 748,709 since the thread client loads from its shipped sidecar (P1b size ruling; 933,161 before);
// 748,976 with the disposed-root gate (root/assemble.ts ROOT_DISPOSED, +267 B, LEAD ruling (a)); 749,055 with the base
// branch at 43ef159329 (utils/src/escape-for-display.ts +196, thread/addressing.ts -53 pre-minify; LEAD ruling).
// 751,102 with the root lifecycle and the nested input copy (code review 7202063494, the security read of b01f3fbdd4;
// root/assemble.ts +2,995, root/threads.ts +353, root/account-sign-in.ts +35 pre-minify; LEAD ruling (a)).
// 751,149 with the after-dispose sentinel rethrown by the threads namespace's two catches (code review
// 7202772023; root/threads.ts +47 B; LEAD ruling (a)).
// 751,758 with free data under any-value fields copied at the boundary (LEAD ruling (1), 20:36Z; root/assemble.ts +609 B; ruling (a)).
// 892,625 at the merge of dev after train 14 (04d7c82657): +140,867 B base-brought, measured: train 14's devices.list imports
// the remote client statically (train 14's tip alone builds this runtime's entry at 674,306 B; per-input table in the merge
// commit's PR body); P1b's own code on the new base is 218,319 B over train 14's runtime. Ruling (a): base bytes move the pin
// in the merge commit only.
const OMO_SDK_RUNTIME_BYTES = 892_625
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
    expect(
      reached.filter((path) => DEFERRED.some((part) => path.includes(part)) && !STATIC_SINCE_TRAIN_14.includes(path)),
    ).toEqual([])
  })

  // Two-way pin (design lane ruling): deferred by P1b's design, static on dev since train 14. Red when the remote-client
  // runtime-file slice (omo#15190) defers them again, so this list is emptied and deleted, and red when any of them
  // reaches the entry by another path than train 14's devices.list.
  test("#given the runtime entry #then the eight thread-contract modules are static by train 14's devices.list and by no other path", async () => {
    const { reached, entry, staticEdges } = await staticModuleSet()
    expect(STATIC_SINCE_TRAIN_14.filter((path) => !reached.includes(path))).toEqual([])
    // Every module the entry reaches by static edges when one module is taken out of the walk.
    const reachedWithout = (skip) => {
      const seen = new Set([entry])
      const queue = [entry]
      while (queue.length > 0)
        for (const next of staticEdges[queue.shift()] ?? [])
          if (next !== skip && !seen.has(next)) {
            seen.add(next)
            queue.push(next)
          }
      return seen
    }
    const chainTo = (target) => {
      const parent = new Map([[entry, undefined]])
      const queue = [entry]
      while (queue.length > 0) {
        const from = queue.shift()
        for (const next of staticEdges[from] ?? [])
          if (!parent.has(next)) {
            parent.set(next, from)
            queue.push(next)
          }
      }
      const chain = []
      for (let at = target; at !== undefined; at = parent.get(at)) chain.unshift(at)
      return chain
    }
    expect(chainTo(STATIC_SINCE_TRAIN_14_CHAIN.at(-1))).toEqual(STATIC_SINCE_TRAIN_14_CHAIN)
    const withoutListing = reachedWithout(TRAIN_14_LISTING)
    expect(STATIC_SINCE_TRAIN_14.filter((path) => withoutListing.has(path))).toEqual([])
  })
})

describe("the root runtime build's kept metafile", () => {
  // Review 6074228823: the copy runs only after a successful build, and the build's own metafile is removed either way.
  test("#given a metafile destination that cannot be written #when the root runtime builds #then the build rejects and leaves no metafile beside its output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omo-sdk-keep-metafile-"))
    perTestRoots.push(dir)
    const output = join(dir, "sdk.js")
    await expect(
      buildOmoSdkRuntime(output, omoSenpiBuildDefines("0.0.0-test"), {
        keepMetafile: join(dir, "missing", "meta.json"),
      }),
    ).rejects.toThrow()
    expect(existsSync(`${output}.meta.json`)).toBe(false)
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
    // given: the plugin layout, runtime/thread-sdk/sdk.js beside the extensions directory and under the plugin manifest,
    // whose imports map the thread client sidecar the SDK's thread core loads on its first host operation (P1b)
    const outputs = await sharedOutputs()
    const plugin = await mkdtemp(join(tmpdir(), "omo-thread-sdk-built-"))
    perTestRoots.push(plugin)
    await mkdir(join(plugin, "runtime", "thread-sdk"), { recursive: true })
    await cp(fileURLToPath(new URL("../package.json", import.meta.url)), join(plugin, "package.json"))
    await cp(outputs.threadSdkOutputPath, join(plugin, "runtime", "thread-sdk", "sdk.js"))
    await cp(dirname(outputs.gatewayStoreWorkerOutputPath), join(plugin, "extensions"), { recursive: true })
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

    // when: a connector script run inline (node, whose `--input-type` the store worker must not inherit) and a bun process
    const answers = await Promise.all(["node", process.execPath].map((runtime) => runProbe(runtime, probe)))

    // then
    for (const answer of answers) {
      expect({ exitCode: answer.exitCode, stderr: answer.stderr }).toEqual({ exitCode: 0, stderr: "" })
      expect(JSON.parse(answer.stdout)).toEqual({
        sent: "queued_offline",
        missing: "not_found",
        unreached: "host_unavailable",
        principal: "cli:501",
      })
    }
  })

  // P1b size ruling: the thread SDK's thread core loads the thread client from the shipped sidecar. Every member is
  // called once; a member that needs the client and cannot load it answers the fixed internal_error, never a throw.
  const threadSdkProbe = (sdkPath, agentDir, extra) =>
    [
      `const { createThreadSdk } = await import(${JSON.stringify(pathToFileURL(sdkPath).href)})`,
      `const sdk = createThreadSdk({ agentDir: ${JSON.stringify(agentDir)}, cwd: process.cwd(), uid: 501, user: "probe", engineStatusAll: async () => undefined })`,
      "const settle = async (run) => { try { const answer = await run(); return answer?.kind === 'error' ? { code: answer.error.code, message: answer.error.message } : { kind: answer?.kind, answer: JSON.stringify(answer) } } catch (error) { return { threw: String(error) } } }",
      // One valid input per member, so each call gets past its own argument check to the host it needs.
      "const inputs = { list: { all_scope: true }, read: { thread: 'dur-off', all_scope: true }, send: { thread: 'dur-off', text: 'ping', all_scope: true }, locate: { thread: 'dur-off', all_scope: true }, create: {}, rename: { thread: 'dur-off', name: 'probe' }, set_model: { thread: 'dur-off', provider: 'p', model: 'm' }, extensionCall: { name: 'probe.ext', op: 'ping', args: {} }, registerStoreExtension: {} }",
      "const members = Object.keys(sdk).filter((key) => typeof sdk[key] === 'function' && key !== 'dispose').sort()",
      "const answers = {}",
      "for (const key of members) answers[key] = await settle(() => sdk[key](inputs[key] ?? { thread: 'dur-off' }))",
      ...extra,
      "await sdk.dispose()",
    ].join("\n")
  const threadClientRefusal = "The thread client of this omo install could not be loaded."
  const expectTyped = (answers) => {
    expect(Object.entries(answers).filter(([, outcome]) => "threw" in outcome)).toEqual([])
    expect(
      Object.entries(answers).filter(([, outcome]) =>
        /omo-thread-client|#omo-|\/|\\/.test(outcome.message ?? outcome.answer ?? ""),
      ),
    ).toEqual([])
    const refused = Object.entries(answers).filter(([, outcome]) => outcome.code === "internal_error")
    expect(refused.filter(([, outcome]) => outcome.message !== threadClientRefusal)).toEqual([])
    // Every member that reaches a host; the store-only members (extensions, warmDaemon) and release answer their own way.
    expect(refused.map(([key]) => key).sort()).toEqual([
      "close",
      "create",
      "interrupt",
      "list",
      "locate",
      "read",
      "rename",
      "send",
      "set_model",
    ])
  }

  test("#given only the thread SDK file and the store worker, copied out of the plugin #when every member runs #then each answers typed and none throws", async () => {
    // given: no manifest maps the client alias and no client file is beside them
    const outputs = await sharedOutputs()
    const dir = await mkdtemp(join(tmpdir(), "omo-thread-sdk-loose-"))
    perTestRoots.push(dir)
    await mkdir(join(dir, "runtime", "thread-sdk"), { recursive: true })
    await mkdir(join(dir, "extensions"), { recursive: true })
    await cp(outputs.threadSdkOutputPath, join(dir, "runtime", "thread-sdk", "sdk.js"))
    await cp(outputs.gatewayStoreWorkerOutputPath, join(dir, "extensions", "gateway-store-worker.mjs"))
    const probe = threadSdkProbe(join(dir, "runtime", "thread-sdk", "sdk.js"), join(dir, "agent"), [
      "console.log(JSON.stringify(answers))",
    ])

    // when
    const answer = await runProbe("node", probe)

    // then
    expect({ exitCode: answer.exitCode, stderr: answer.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expectTyped(JSON.parse(answer.stdout))
  })

  test("#given the installed layout without the thread client #when every thread SDK member runs #then each answers typed with fixed text, and the client is loaded once it is back", async () => {
    // given
    const outputs = await sharedOutputs()
    const plugin = await mkdtemp(join(tmpdir(), "omo-thread-sdk-no-client-"))
    perTestRoots.push(plugin)
    await mkdir(join(plugin, "runtime", "thread-sdk"), { recursive: true })
    await cp(fileURLToPath(new URL("../package.json", import.meta.url)), join(plugin, "package.json"))
    await cp(outputs.threadSdkOutputPath, join(plugin, "runtime", "thread-sdk", "sdk.js"))
    await cp(dirname(outputs.gatewayStoreWorkerOutputPath), join(plugin, "extensions"), { recursive: true })
    const agentDir = join(plugin, "agent")
    const sessionsDir = join(agentDir, "sessions", "--probe--")
    await mkdir(sessionsDir, { recursive: true })
    await writeFile(
      join(sessionsDir, "epoch_dur-off.jsonl"),
      `${JSON.stringify({ type: "session", id: "dur-off", cwd: process.cwd(), timestamp: "2026-10-02T00:00:00Z" })}\n`,
    )
    const client = join(plugin, "extensions", "omo-thread-client.js")
    await cp(client, `${client}.saved`)
    await rm(client)
    const probe = threadSdkProbe(join(plugin, "runtime", "thread-sdk", "sdk.js"), agentDir, [
      `const { copyFileSync } = await import("node:fs")`,
      `copyFileSync(${JSON.stringify(`${client}.saved`)}, ${JSON.stringify(client)})`,
      "const back = await sdk.send({ thread: 'dur-off', text: 'ping', all_scope: true })",
      "console.log(JSON.stringify({ answers, back: back.kind === 'ok' ? back.delivery.kind : back.error.code }))",
    ])

    // when
    const answer = await runProbe("node", probe)

    // then: a failed load is not kept, so the restored file is loaded by the same SDK instance
    expect({ exitCode: answer.exitCode, stderr: answer.stderr }).toEqual({ exitCode: 0, stderr: "" })
    const { answers, back } = JSON.parse(answer.stdout)
    expectTyped(answers)
    expect(back).toBe("queued_offline")
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

  // P1b size ruling: the root's thread core loads the thread client from the shipped sidecar (#omo-thread-client-runtime,
  // extensions/omo-thread-client.js) instead of carrying it. The installed layout is the plugin manifest (its imports map
  // the alias), runtime/omo-sdk/sdk.js and the extensions directory.
  const installedRoot = async (prefix) => {
    const outputs = await sharedOutputs()
    const plugin = await mkdtemp(join(tmpdir(), prefix))
    perTestRoots.push(plugin)
    await mkdir(join(plugin, "runtime", "omo-sdk"), { recursive: true })
    await cp(fileURLToPath(new URL("../package.json", import.meta.url)), join(plugin, "package.json"))
    await cp(outputs.omoSdkOutputPath, join(plugin, "runtime", "omo-sdk", "sdk.js"))
    await cp(dirname(outputs.threadClientOutputPath), join(plugin, "extensions"), { recursive: true })
    const agentDir = join(plugin, "agent")
    // A thread no host serves, known from its session file: a send to it is stored queued_offline, through the client.
    const sessionsDir = join(agentDir, "sessions", "--probe--")
    await mkdir(sessionsDir, { recursive: true })
    await writeFile(
      join(sessionsDir, "epoch_dur-off.jsonl"),
      `${JSON.stringify({ type: "session", id: "dur-off", cwd: plugin, timestamp: "2026-10-02T00:00:00Z" })}\n`,
    )
    return { plugin, agentDir, client: join(plugin, "extensions", "omo-thread-client.js") }
  }
  const openRoot = (plugin, agentDir) =>
    [
      `const { createOmoSdk } = await import(${JSON.stringify(pathToFileURL(join(plugin, "runtime", "omo-sdk", "sdk.js")).href)})`,
      `const root = createOmoSdk({ env: { HOME: ${JSON.stringify(plugin)} }, cwd: ${JSON.stringify(plugin)}, home: ${JSON.stringify(plugin)}, agentDir: ${JSON.stringify(agentDir)} })`,
    ].join("\n")

  test("#given the installed layout #when a plain node script and a bun process send through the root #then the root loads the shipped thread client and the send is stored", async () => {
    // given
    const { plugin, agentDir } = await installedRoot("omo-sdk-thread-client-")
    const probe = [
      openRoot(plugin, agentDir),
      "const sent = await root.threads.send({ thread: 'dur-off', message: 'ping', all_scope: true })",
      "await root.dispose()",
      "console.log(JSON.stringify(sent.kind === 'ok' ? { delivery: sent.delivery.kind } : { code: sent.error.code }))",
    ].join("\n")

    // when: node runs it as a script; bun runs it as an eval cell's process does
    const answers = await Promise.all(["node", process.execPath].map((runtime) => runProbe(runtime, probe)))

    // then
    for (const answer of answers) {
      expect({ exitCode: answer.exitCode, stderr: answer.stderr }).toEqual({ exitCode: 0, stderr: "" })
      expect(JSON.parse(answer.stdout)).toEqual({ delivery: "queued_offline" })
    }
  })

  test("#given the installed layout without the thread client #when every root thread call runs #then each answers a typed refusal with fixed text, and the client is loaded once it is back", async () => {
    // given: one input per threads.* call, built from its schema's required fields
    const { ROOT_CALLS } = await import("../../src/components/omo-sdk/contract/calls.ts")
    const { ROOT_CALL_ANSWERS } = await import("../../src/components/omo-sdk/contract/call-answers.ts")
    const valueOf = (schema) =>
      schema?.type === "boolean"
        ? false
        : schema?.type === "number" || schema?.type === "integer"
          ? 1
          : schema?.type === "object"
            ? {}
            : schema?.type === "array"
              ? []
              : "dur-off"
    const calls = Object.keys(ROOT_CALL_ANSWERS)
      .filter((key) => key.startsWith("threads."))
      .map((key) => {
        const input = ROOT_CALLS[key].input
        const fields = Object.fromEntries(
          (input.required ?? []).map((field) => [field, valueOf(input.properties?.[field])]),
        )
        return { key, input: fields, stream: ROOT_CALL_ANSWERS[key] === "stream" }
      })
    const { plugin, agentDir, client } = await installedRoot("omo-sdk-no-thread-client-")
    const saved = `${client}.saved`
    await cp(client, saved)
    await rm(client)
    const probe = [
      openRoot(plugin, agentDir),
      `const calls = ${JSON.stringify(calls)}`,
      "const at = (key) => key.split('.').reduce((node, part) => node[part], root)",
      "const settle = async ({ key, input, stream }) => {",
      "  try {",
      "    const answer = at(key)(input)",
      "    if (stream) { for await (const event of answer) if (event.kind === 'end') return event.failure ? { code: event.failure.code, message: event.failure.message } : { kind: 'end' }; return { kind: 'no_end' } }",
      "    const settled = await answer",
      "    return settled.kind === 'error' ? { code: settled.error.code, message: settled.error.message } : { kind: settled.kind }",
      "  } catch (error) { return { threw: String(error) } }",
      "}",
      "const absent = {}",
      "for (const call of calls) absent[call.key] = await settle(call)",
      `const { copyFileSync } = await import('node:fs')`,
      `copyFileSync(${JSON.stringify(saved)}, ${JSON.stringify(client)})`,
      "const back = await root.threads.send({ thread: 'dur-off', message: 'ping', all_scope: true })",
      "await root.dispose()",
      "console.log(JSON.stringify({ absent, back: back.kind === 'ok' ? back.delivery.kind : back.error.code }))",
    ].join("\n")

    // when
    const answer = await runProbe("node", probe)

    // then: nothing throws, nothing names a path or the specifier, and every call that needs the client answers the
    // fixed internal_error; a failed load is not kept, so the restored file is loaded by the same root
    expect({ exitCode: answer.exitCode, stderr: answer.stderr }).toEqual({ exitCode: 0, stderr: "" })
    const { absent, back } = JSON.parse(answer.stdout)
    expect(Object.keys(absent).sort()).toEqual(calls.map(({ key }) => key).sort())
    expect(Object.entries(absent).filter(([, outcome]) => "threw" in outcome)).toEqual([])
    expect(
      Object.entries(absent).filter(([, outcome]) => /omo-thread-client|#omo-|\/|\\/.test(outcome.message ?? "")),
    ).toEqual([])
    const refused = Object.entries(absent).filter(([, outcome]) => outcome.code === "internal_error")
    expect(
      refused.every(([, outcome]) => outcome.message === "The thread client of this omo install could not be loaded."),
    ).toBe(true)
    expect(refused.map(([key]) => key)).toEqual(
      expect.arrayContaining(["threads.list", "threads.read", "threads.send"]),
    )
    expect(back).toBe("queued_offline")
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
