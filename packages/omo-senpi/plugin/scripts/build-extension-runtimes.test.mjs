import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createGatewayStore, gatewayStoreWorkerUrl } from "../../src/components/thread/gateway/store.ts"

import {
  buildOmoSdkRuntime,
  buildRuntimeFile,
  buildSdkRuntimeFiles,
  runtimeFileExternals,
  omoSenpiBuildDefines,
  resolveOutputs,
} from "./build-extension-core.mjs"
import { checkExtensionCurrent } from "./build-extension.mjs"
import { sdkRuntimeFilesCurrent } from "./check-extension-current.mjs"
import { runtimeArtifactPaths, SDK_RUNTIME_FILES, sdkRuntimeOutputPaths } from "./runtime-files.mjs"
import {
  difference,
  normalizeModulePath,
  STATIC_SET_PATH,
  STATIC_SINCE_TRAIN_14,
  STATIC_SINCE_TRAIN_14_CHAIN,
  staticModuleSet,
  staticSetDefinition,
  staticSetPath,
  TRAIN_14_LISTING,
} from "./omo-sdk-static-set.mjs"
import { createBuildFixture, BUILD_HOOK_OUTER_BOUND_MS } from "./build-extension.test-support.mjs"
import { THREAD_CLIENT_UNAVAILABLE, thrown } from "../../src/components/thread/sdk-core/failures.ts"

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

// An SDK runtime file of a build, by its table row name (runtime-files.mjs).
const sdkFile = (outputs, name) => sdkRuntimeOutputPaths(outputs.sdkRuntimeRoot)[name]
const rowNamed = (name) => SDK_RUNTIME_FILES.find((row) => row.name === name)
// The one dynamic import of a file a build wrote (remote import guard G1 counts each non-literal import).
const importBuilt = (path) => import(pathToFileURL(path).href)
const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
const packageVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version

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
})

// The provisioned SDK root runtime's cold-import decision (design lane and owner, P1b #14950): the call table, the thread
// contracts and the thread core load on first use. Since slice P1c (#15031) every SDK runtime file has its own row in
// runtime-files.mjs carrying its byte ceiling (the file's measured size, amendment 28) and its committed kept list, so a
// row added there is pinned here with no other edit. Growth past a ceiling, or a new static path, reopens the decision:
// thread slices move the thread file's number, not the root's. A size is valid only in a tree with submodules
// initialised and a frozen install from the head's own bun.lock, built with the pinned bun.
const DEFERRED = ["omo-sdk/contract/calls.ts", "components/thread/contracts/", "components/thread/sdk-core/index.ts"]

// What ships and runs at import (design lane ruling of record): the built runtime's inputs that keep bytes in its output,
// reached from the entry by static edges only, plus the node builtins a kept module imports, named the same in every
// install layout. plugin/scripts/omo-sdk-static-set.mjs computes it; `bun <that file> --write` rewrites every list, and a
// slice that changes a set edits the list in the same commit, where its reviewer sees it.
const { modules: STATIC_SET } = JSON.parse(readFileSync(STATIC_SET_PATH, "utf8"))

/**
 * What a row's pins say of one built file: over its ceiling or not, how its kept modules differ from its list, and the
 * packages it inlines against the row's set (review 6076881626: every SDK runtime file has its own package pin).
 */
async function pinFindings(row, outputPath, inputs, table = SDK_RUNTIME_FILES) {
  const bytes = Bun.file(outputPath).size
  const { definition, modules } = JSON.parse(readFileSync(staticSetPath(row), "utf8"))
  const { set } = await staticModuleSet(undefined, { row, table })
  return {
    file: row.name,
    overCeiling: bytes > row.ceiling ? `${bytes} bytes, over its ceiling of ${row.ceiling}` : null,
    definition: definition === staticSetDefinition(row),
    ...difference(set, modules),
    packages: inlinedPackages(inputs),
  }
}

const pinned = (row) => ({
  file: row.name,
  overCeiling: null,
  definition: true,
  added: [],
  removed: [],
  packages: [...row.packages],
})

describe("every SDK runtime file within its row's ceiling, shipping exactly its committed list", () => {
  for (const row of SDK_RUNTIME_FILES)
    test(`#given the built ${row.name} runtime file #then it is within its row's ceiling and ships exactly its row's kept list`, async () => {
      const outputs = await sharedOutputs()
      expect(await pinFindings(row, sdkFile(outputs, row.name), outputs.sdkRuntimeInputs[row.name])).toEqual(
        pinned(row),
      )
    })
})

describe("the provisioned SDK root runtime's cold import (P1b decision)", () => {
  // Control: one static telemetry import added to the runtime entry is named by the comparison.
  test("#given an entry that adds one static telemetry import to the runtime entry #then the comparison names the telemetry modules it adds", async () => {
    const dir = await mkdtemp(join(packageRoot, "src", "extension", ".static-control-"))
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

describe("the SDK root's thread runtime file (P1c, #15031)", () => {
  // Static on dev since train 14 and matched by the text predicate below only through its basename ('context' holds
  // 'text'): a thread module the device list's static import of the remote client brings, not a thread text module.
  // Owner: omo#15190, which defers it again and empties and deletes this list; the predicates themselves are unchanged.
  const THREAD_TEXT_STATIC_SINCE_TRAIN_14 = ["packages/omo-senpi/src/components/thread/remote/context-tail.ts"]

  test("#given the root's build #then no module of the thread core is among its inputs, and its logger-port helper is", async () => {
    const { root } = (await sharedOutputs()).sdkRuntimeInputs
    expect(root.filter((path) => path.includes("components/thread/sdk-core/"))).toEqual([])
    expect(
      root
        .filter((path) => /components\/thread\/.*text[^/]*\.ts$/.test(path))
        .filter((path) => !THREAD_TEXT_STATIC_SINCE_TRAIN_14.includes(path)),
    ).toEqual([])
    expect(root.some((path) => path.endsWith("components/omo-sdk/unexpected-port.ts"))).toBe(true)
  })

  test("#given the root's runtime entry #then the named thread module is static by train 14's devices.list and by no other path", async () => {
    const { root } = (await sharedOutputs()).sdkRuntimeInputs
    expect(THREAD_TEXT_STATIC_SINCE_TRAIN_14.filter((path) => !root.includes(path))).toEqual([])
    const { entry, staticEdges } = await staticModuleSet()
    const seen = new Set([entry])
    const queue = [entry]
    while (queue.length > 0)
      for (const next of staticEdges[queue.shift()] ?? [])
        if (next !== TRAIN_14_LISTING && !seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
    expect(THREAD_TEXT_STATIC_SINCE_TRAIN_14.filter((path) => seen.has(path))).toEqual([])
  })

  test("#given the thread file's build #then the thread core is among its inputs and the root's entry is not", async () => {
    const { threads } = (await sharedOutputs()).sdkRuntimeInputs
    expect(threads.some((path) => path.includes("components/thread/sdk-core/"))).toBe(true)
    expect(threads.some((path) => path.endsWith("src/extension/omo-sdk.ts"))).toBe(false)
  })

  // Review 6075851574 LOW 7: the file this build wrote, so a change to the entry cannot pass against a committed bundle;
  // the committed file the plugin ships must export the same names.
  test("#given the freshly built thread runtime file #then it exports exactly what the root takes, as functions and plain data, with this build's stamp, as the shipped file does", async () => {
    const outputs = await sharedOutputs()
    const fresh = await importBuilt(sdkFile(outputs, "threads"))
    const { RUNTIME_STAMP, createThreadCore, fail, threadToolParamSchemas, ...rest } = fresh
    expect(Object.keys(rest)).toEqual([])
    expect([typeof createThreadCore, typeof fail]).toEqual(["function", "function"])
    expect(Object.getPrototypeOf(threadToolParamSchemas)).toBe(Object.prototype)
    expect(RUNTIME_STAMP).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const shipped = await import("../runtime/omo-sdk/threads.js")
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(fresh).sort())
  })
})

// Review 6075851574 HIGH 1: one row is enough to add a runtime file. A third row goes through the real build (with the
// shared stamp), its row's ceiling and kept list, the installer's derived list and the freshness comparison.
describe("a row added to the SDK runtime file table", () => {
  test("#given a third row #then it is built with the build's stamp, sized, kept-list-checked, listed for the installer and checked for freshness", async () => {
    const source = await mkdtemp(join(packageRoot, "src", "extension", ".probe-row-"))
    const out = await mkdtemp(join(tmpdir(), "omo-sdk-probe-row-"))
    const reproduction = await mkdtemp(join(tmpdir(), "omo-sdk-probe-row-expected-"))
    perTestRoots.push(source, out, reproduction)
    for (const name of ["entry", "sibling"])
      await writeFile(
        join(source, `${name}.ts`),
        `export { RUNTIME_STAMP } from "../../components/omo-sdk/runtime-stamp"\nexport const ${name} = "${name}"\n`,
      )
    const probe = {
      name: "probe",
      entry: join(source, "entry.ts"),
      output: "runtime/omo-sdk/probe.js",
      specifier: "#omo-sdk-probe-runtime",
      lazy: true,
      ceiling: 4096,
      staticSet: join(source, "kept.json"),
      packages: [],
    }
    const table = [...SDK_RUNTIME_FILES, probe]
    // What is built: the probe and a second tiny row, so the stamp is compared across two files of one build without
    // rebuilding the shipped rows (those are built and pinned once, by the shared build above). Every check that does not
    // build takes the whole table.
    const sibling = {
      ...probe,
      name: "sibling",
      entry: join(source, "sibling.ts"),
      output: "runtime/omo-sdk/sibling.js",
    }
    const built = [sibling, probe]
    const defines = omoSenpiBuildDefines(packageVersion)

    // built, with the stamp every file of the build carries
    const inputs = await buildSdkRuntimeFiles(sdkRuntimeOutputPaths(out, built), defines, built)
    const paths = sdkRuntimeOutputPaths(out, built)
    expect(inputs.probe.some((input) => input.endsWith("entry.ts"))).toBe(true)
    const [probeStamp, siblingStamp] = await Promise.all(
      [paths.probe, paths.sibling].map(async (path) => (await importBuilt(path)).RUNTIME_STAMP),
    )
    expect(probeStamp).toBe(siblingStamp)

    // sized and kept-list-checked by the same pins as the shipped rows; each negative control is named
    const { set } = await staticModuleSet(undefined, { row: probe, table: built })
    await writeFile(probe.staticSet, JSON.stringify({ definition: staticSetDefinition(probe), modules: set }))
    expect(await pinFindings(probe, paths.probe, inputs.probe, built)).toEqual(pinned(probe))
    expect((await pinFindings({ ...probe, ceiling: 1 }, paths.probe, inputs.probe, built)).overCeiling).toMatch(
      /over its ceiling of 1$/,
    )
    await writeFile(probe.staticSet, JSON.stringify({ definition: staticSetDefinition(probe), modules: set.slice(1) }))
    expect((await pinFindings(probe, paths.probe, inputs.probe, built)).added).toEqual([set[0]])

    // listed for the installer; every other row leaves it external, and it leaves every other row external, the root
    // included, so a lazy file that imports the root's specifier cannot inline the root (review 6076881626)
    expect(runtimeArtifactPaths(table)).toContain(join("runtime", "omo-sdk", "probe.js"))
    for (const other of table.filter((row) => row !== probe)) {
      expect(runtimeFileExternals(other, table)).toContain(probe.specifier)
      expect(runtimeFileExternals(probe, table)).toContain(other.specifier)
    }

    // checked for freshness: current against an independent reproduction, then missing, then stale
    await buildSdkRuntimeFiles(sdkRuntimeOutputPaths(reproduction, built), defines, built)
    const expected = sdkRuntimeOutputPaths(reproduction, built)
    expect(await sdkRuntimeFilesCurrent(paths, expected)).toEqual({ ok: true })
    await writeFile(paths.probe, `${readFileSync(paths.probe, "utf8")}\n`)
    expect(await sdkRuntimeFilesCurrent(paths, expected)).toEqual({
      ok: false,
      reason: "stale-output",
      output: paths.probe,
    })
    await rm(paths.probe)
    expect(await sdkRuntimeFilesCurrent(paths, expected)).toEqual({
      ok: false,
      reason: "missing-output",
      output: paths.probe,
    })
  })
})

// Review 6075851574 MEDIUM 4: the SDK runtime files are written under a named plugin output root, never under a root cut
// out of another file's path; the build and the freshness check both take their outputs from resolveOutputs.
describe("the SDK runtime files' output root", () => {
  test("#given an explicit root, or only a short custom extension path #then every runtime file sits at its table output under that root", () => {
    expect(resolveOutputs({ sdkRuntimeRoot: "/srv/plugin-out" }).sdkRuntimeOutputs).toEqual(
      sdkRuntimeOutputPaths("/srv/plugin-out"),
    )
    expect(resolveOutputs({ outputPath: "/tmp/omo.js" }).sdkRuntimeOutputs).toEqual(sdkRuntimeOutputPaths("/tmp"))
    expect(resolveOutputs({ outputPath: "/tmp/omo.js", sdkRuntimeRoot: "/srv/plugin-out" }).sdkRuntimeOutputs).toEqual(
      sdkRuntimeOutputPaths("/srv/plugin-out"),
    )
  })

  test("#given an explicit root missing one runtime file #when freshness is checked #then it names that file under that root", async () => {
    const outputs = await mutableOutputs()
    const root = await mkdtemp(join(tmpdir(), "omo-sdk-explicit-root-"))
    perTestRoots.push(root)
    const paths = sdkRuntimeOutputPaths(root)
    await mkdir(dirname(paths.root), { recursive: true })
    await cp(sdkFile(outputs, "root"), paths.root)
    expect(await checkExtensionCurrent({ ...outputs, sdkRuntimeRoot: root })).toMatchObject({
      ok: false,
      reason: "missing-output",
      output: paths.threads,
    })
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
    const sdk = await importBuilt(outputs.threadSdkOutputPath)
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
  // The thread core's own answer, from the one place it is worded, so a reword there cannot leave this test behind.
  const threadClientRefusal = thrown(new Error(THREAD_CLIENT_UNAVAILABLE)).error.message
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
    expect(outputs.sdkRuntimeInputs.root.some((input) => input.endsWith("src/extension/omo-sdk.ts"))).toBe(true)
    const home = await mkdtemp(join(tmpdir(), "omo-sdk-built-"))
    perTestRoots.push(home)
    const probe = [
      `const sdk = await import(${JSON.stringify(pathToFileURL(sdkFile(outputs, "root")).href)})`,
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
    await cp(sdkFile(outputs, "root"), join(plugin, "runtime", "omo-sdk", "sdk.js"))
    await cp(outputs.gatewayStoreWorkerOutputPath, join(plugin, "extensions", "gateway-store-worker.mjs"))
    await cp(sdkFile(outputs, "threads"), join(plugin, "runtime", "omo-sdk", "threads.js"))
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

  // P1b size ruling: the root's thread core loads the thread client from the shipped sidecar (#omo-thread-client-runtime,
  // extensions/omo-thread-client.js) instead of carrying it. The installed layout is the plugin manifest (its imports map
  // the alias), runtime/omo-sdk/sdk.js and the extensions directory.
  const installedRoot = async (prefix) => {
    const outputs = await sharedOutputs()
    const plugin = await mkdtemp(join(tmpdir(), prefix))
    perTestRoots.push(plugin)
    await mkdir(join(plugin, "runtime", "omo-sdk"), { recursive: true })
    await cp(fileURLToPath(new URL("../package.json", import.meta.url)), join(plugin, "package.json"))
    await cp(sdkFile(outputs, "root"), join(plugin, "runtime", "omo-sdk", "sdk.js"))
    await cp(sdkFile(outputs, "threads"), join(plugin, "runtime", "omo-sdk", "threads.js"))
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
      refused.every(([, outcome]) => outcome.message === thrown(new Error(THREAD_CLIENT_UNAVAILABLE)).error.message),
    ).toBe(true)
    expect(refused.map(([key]) => key)).toEqual(
      expect.arrayContaining(["threads.list", "threads.read", "threads.send"]),
    )
    expect(back).toBe("queued_offline")
  })

  // Slice P1c (#15031): the thread core ships in its own file beside the root, resolved through the plugin manifest's
  // import map, so a source-layout test proves nothing about it; these run the shipped files in a plugin layout, in a
  // directory whose parent holds a manifest that maps the same specifiers elsewhere (security review 6075906719, L3).
  async function pluginLayout(outputs, threadsFile = sdkFile(outputs, "threads")) {
    const parent = await mkdtemp(join(tmpdir(), "omo-sdk-split-layout-"))
    perTestRoots.push(parent)
    const plugin = join(parent, "plugin")
    await mkdir(join(plugin, "runtime", "omo-sdk"), { recursive: true })
    await cp(sdkFile(outputs, "root"), join(plugin, "runtime", "omo-sdk", "sdk.js"))
    await cp(threadsFile, join(plugin, "runtime", "omo-sdk", "threads.js"))
    await cp(fileURLToPath(new URL("../package.json", import.meta.url)), join(plugin, "package.json"))
    // The thread core loads the thread client from the shipped extensions (P1b size ruling).
    await cp(dirname(outputs.threadClientOutputPath), join(plugin, "extensions"), { recursive: true })
    await writeFile(join(parent, "decoy.mjs"), "throw new Error('the decoy above the package was loaded')\n")
    await writeFile(
      join(parent, "package.json"),
      JSON.stringify({
        type: "module",
        imports: Object.fromEntries(SDK_RUNTIME_FILES.map((row) => [row.specifier, "./decoy.mjs"])),
      }),
    )
    return plugin
  }

  // One process: each step's thread call is answered, then `between` (a file operation of the script) runs before the
  // next. The output is one line per thread call: its kind, or its code and reason, and whether its text says restart.
  async function runSteps(runtime, plugin, steps) {
    const threads = join(plugin, "runtime", "omo-sdk", "threads.js")
    const probe = [
      `import { rename, writeFile, copyFile } from "node:fs/promises"`,
      `const { createOmoSdk } = await import(${JSON.stringify(pathToFileURL(join(plugin, "runtime", "omo-sdk", "sdk.js")).href)})`,
      `const root = createOmoSdk({ env: { HOME: ${JSON.stringify(plugin)} }, cwd: ${JSON.stringify(plugin)}, home: ${JSON.stringify(plugin)}, agentDir: ${JSON.stringify(join(plugin, "agent"))}, ports: { desktopLaunch: () => false, credentialStore: { read: async () => null } } })`,
      `const threads = ${JSON.stringify(threads)}`,
      "const answers = []",
      // A non-thread call, run where a step puts it (with the thread file absent, in the retry test: review 6076881626).
      "const configs = []",
      "const askConfig = async () => { configs.push((await root.config.status()).kind) }",
      "const ask = async () => { const sent = await root.threads.list({}); answers.push(sent.kind === 'error' ? { code: sent.error.code, reason: sent.error.details?.reason ?? null, restart: sent.error.code === 'internal_error' ? /restart/i.test(sent.error.message) : null } : sent.kind) }",
      ...steps,
      "await root.dispose()",
      "console.log(JSON.stringify({ configs, answers }))",
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

  // No engine runs here, so a thread core that loaded reports the host unavailable.
  const LOADED = { code: "host_unavailable", reason: null, restart: null }
  const UNAVAILABLE = { code: "internal_error", reason: "runtime_file_unavailable", restart: true }

  for (const runtime of ["node", "bun"]) {
    test(`#given the two built SDK files in a plugin layout #when ${runtime} runs a script #then an account call needs no thread file and a thread call loads it, never through the manifest above the package`, async () => {
      const plugin = await pluginLayout(await sharedOutputs())
      expect(await runSteps(runtime, plugin, ["await askConfig()", "await ask()"])).toEqual({
        configs: ["ok"],
        answers: [LOADED],
      })
    })

    // Review 6075851574 MEDIUM 5, the retry contract: the root re-imports on every call and keeps nothing itself, so a
    // missing file put back loads on the next call of the same process.
    test(`#given a thread file missing on the first call and put back #when ${runtime} makes the next call in the same process #then the first is refused and the next loads it`, async () => {
      const plugin = await pluginLayout(await sharedOutputs())
      const answered = await runSteps(runtime, plugin, [
        "await rename(threads, `${threads}.aside`)",
        "await ask()",
        "await askConfig()",
        "await rename(`${threads}.aside`, threads)",
        "await ask()",
      ])
      expect(answered).toEqual({ configs: ["ok"], answers: [UNAVAILABLE, LOADED] })
    })

    // The platform's module loader keeps a file whose evaluation failed for the life of the process: the refusal says to
    // restart, and replacing the file does not change that (stated, not hidden; no cache-busting second instance).
    test(`#given a thread file whose evaluation fails #when ${runtime} replaces it and calls again in the same process #then both calls are refused and say to restart`, async () => {
      const plugin = await pluginLayout(await sharedOutputs())
      const answered = await runSteps(runtime, plugin, [
        "await copyFile(threads, `${threads}.good`)",
        "await writeFile(threads, 'throw new Error(\"evaluation failed\")\\n')",
        "await ask()",
        "await copyFile(`${threads}.good`, threads)",
        "await ask()",
      ])
      expect(answered).toEqual({ configs: [], answers: [UNAVAILABLE, UNAVAILABLE] })
    })

    // Design lane ruling on the security note (A), recorded behaviour B11: a root of one build with the thread file of
    // another (an in-place update while the process ran) is refused typed, and the refusal says to restart.
    test(`#given a root of one build and a thread file of another #when ${runtime} makes a thread call #then it answers runtime_file_mismatch and says to restart`, async () => {
      const outputs = await sharedOutputs()
      const other = await mkdtemp(join(tmpdir(), "omo-sdk-other-build-"))
      perTestRoots.push(other)
      await buildRuntimeFile(rowNamed("threads"), join(other, "threads.js"), {
        ...omoSenpiBuildDefines(packageVersion),
        OMO_SDK_RUNTIME_STAMP: "another-build",
      })
      const plugin = await pluginLayout(outputs, join(other, "threads.js"))
      expect(await runSteps(runtime, plugin, ["await ask()"])).toEqual({
        configs: [],
        answers: [{ code: "internal_error", reason: "runtime_file_mismatch", restart: true }],
      })
    })
  }

  test("#given the built extension without the thread runtime file #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    await rm(sdkFile(outputs, "threads"))
    expect(await checkExtensionCurrent(outputs)).toMatchObject({
      ok: false,
      reason: "missing-output",
      output: sdkFile(outputs, "threads"),
    })
  })

  test("#given the built extension without the omo SDK #when freshness is checked #then it reports that output missing", async () => {
    const outputs = await mutableOutputs()
    await rm(sdkFile(outputs, "root"))
    expect(await checkExtensionCurrent(outputs)).toMatchObject({
      ok: false,
      reason: "missing-output",
      output: sdkFile(outputs, "root"),
    })
  })
})
