// Security/architecture contract (omo#13440): the modules an `omo remote` status/session verb runs through - the
// account read, the session verbs, the thread adapter over the local API, the local API client, and the gateway
// store worker - reach the network only through the local API transport. A new network import, a new network call,
// a new process spawn site or a second worker anywhere in that graph fails here, so the engine-trust stage can later
// be skipped for these verbs without a call slipping onto unfiltered trust. The graph comes from Bun's own bundler
// metafile; a missing or empty graph, or one that lacks the known transport and worker, fails rather than passes.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const at = (path: string) => join(repoRoot, path)

const ROOTS = [
  "packages/omo-native/account-show.ts",
  "packages/omo-native/remote-session-verbs.ts",
  "packages/omo-senpi/src/components/thread/remote/device-service.ts",
  "packages/device-service-core/src/device-service.ts",
  "packages/omo-senpi/src/components/thread/gateway/store-worker.ts",
]

const TRANSPORT = "packages/device-service-core/src/local-api/transport.ts"
const STORE = "packages/omo-senpi/src/components/thread/gateway/store.ts"
const STORE_WORKER = "packages/omo-senpi/src/components/thread/gateway/store-worker.ts"
const NETWORK_MODULES = new Set(["tls", "https", "http", "http2", "dgram", "dns"])

// Local tools only, each reviewed: the keyring and home lookups, the Windows access list, git provenance, and ps.
const CHILD_PROCESS_IMPORTERS = [
  "packages/device-service-core/src/local-api/dacl.ts",
  "packages/omo-opencode/src/cli/service-auth/account-home.ts",
  "packages/omo-opencode/src/cli/service-auth/secret-service-lock.ts",
  "packages/omo-senpi/src/components/thread/addressing.ts",
  "packages/omo-senpi/src/components/thread/gateway/process-identity.ts",
  "packages/omo-senpi/src/components/thread/gateway/provenance-resolver.ts",
]
// The macOS keychain helper, `security`/`codesign`, and the desktop runtime's `account token` hand-off.
const SPAWN_SHIM_IMPORTERS = [
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/client.ts",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/creator-handoff.ts",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/owner-marker.ts",
  "packages/omo-opencode/src/cli/service-auth/keychain-helper/signature.ts",
]

const NETWORK_CALL =
  /(?<![.\w$])fetch\s*\(|\?\?\s*(?:globalThis\.)?fetch\b|globalThis\.fetch\b|\bnew\s+WebSocket\b|\bBun\.(?:connect|listen|fetch)\b/g
const WORKER = /\bnew\s+Worker\b/g

type Input = { readonly imports: readonly { readonly path: string; readonly external?: boolean }[] }

async function graph(): Promise<Record<string, Input>> {
  const built = (await Bun.build({
    entrypoints: ROOTS.map(at),
    target: "bun",
    metafile: true,
    throw: false,
    root: repoRoot,
  } as Parameters<typeof Bun.build>[0])) as Awaited<ReturnType<typeof Bun.build>> & {
    readonly metafile?: { readonly inputs: Record<string, Input> }
  }
  expect(built.success).toBe(true)
  const inputs = built.metafile?.inputs
  if (inputs === undefined || Object.keys(inputs).length === 0) throw new Error("the bundler returned no module graph")
  return Object.fromEntries(Object.entries(inputs).map(([file, input]) => [relative(repoRoot, at(file)), input]))
}

const importersOf = (inputs: Record<string, Input>, modules: (name: string) => boolean): string[] =>
  Object.entries(inputs)
    .filter(([, input]) => input.imports.some((entry) => entry.external === true && modules(entry.path.replace(/^node:/, ""))))
    .map(([file]) => file)
    .sort()

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")

describe("remote local-path reachability", () => {
  test("#given the local path's module graph #when it is scanned #then it reaches the network only through the local API transport", async () => {
    // given
    const inputs = await graph()
    for (const sentinel of [...ROOTS, TRANSPORT, STORE]) expect(Object.keys(inputs)).toContain(sentinel)

    // when
    const netImporters = importersOf(inputs, (name) => name === "net")
    const networkImporters = importersOf(inputs, (name) => NETWORK_MODULES.has(name))
    const childProcessImporters = importersOf(inputs, (name) => name === "child_process")
    const workerThreadImporters = importersOf(inputs, (name) => name === "worker_threads")
    const shimImporters = Object.entries(inputs)
      .filter(([, input]) => input.imports.some((entry) => entry.path.endsWith("shared/bun-spawn-shim.ts")))
      .map(([file]) => file)
      .sort()
    const calls: string[] = []
    const workers: string[] = []
    for (const file of Object.keys(inputs)) {
      if (!/\.(?:ts|js|mjs)$/.test(file)) continue
      const source = withoutComments(readFileSync(at(file), "utf8"))
      for (const match of source.matchAll(NETWORK_CALL)) calls.push(`${file}: ${match[0]}`)
      if (WORKER.test(source)) workers.push(file)
      WORKER.lastIndex = 0
    }

    // then
    expect(netImporters).toEqual([TRANSPORT])
    expect(networkImporters).toEqual([])
    expect(calls).toEqual([])
    expect(childProcessImporters).toEqual([...CHILD_PROCESS_IMPORTERS].sort())
    expect(shimImporters).toEqual([...SPAWN_SHIM_IMPORTERS].sort())
    expect(workerThreadImporters).toEqual([STORE, STORE_WORKER].sort())
    expect(workers).toEqual([STORE])
  })
})
