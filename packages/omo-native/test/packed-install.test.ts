import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

const packageRoot = join(import.meta.dir, "..")
// Each step's own bound, inside the test's 240 s: a stuck step fails here instead of overrunning the test (#13974).
const STEP_BOUND_MS = 200_000

type Step = { readonly exitCode: number; readonly stdout: string; readonly stderr: string }

/** Runs one command and awaits its exit, killing it and failing once the bound passes. */
async function step(
  cmd: readonly string[],
  options: { cwd: string; env?: Record<string, string | undefined> },
): Promise<Step> {
  const proc = Bun.spawn([...cmd], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  let bound: ReturnType<typeof setTimeout> | undefined
  const overran = new Promise<never>((_, reject) => {
    bound = setTimeout(() => {
      proc.kill()
      reject(new Error(`${cmd.join(" ")} did not exit within ${STEP_BOUND_MS} ms`))
    }, STEP_BOUND_MS)
  })
  try {
    const [exitCode, stdout, stderr] = await Promise.race([
      Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]),
      overran,
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(bound)
  }
}

// Every `bun add` this file runs: the cache it used and how many top-level cache entries it added (#13974).
const installs: { readonly cache: string; readonly added: number }[] = []
const cacheEntries = (cache: string): number => (existsSync(cache) ? readdirSync(cache).length : 0)

let root = ""
let tarball = ""

/**
 * Runs `bun add` against this file's own install cache under its temp root, shared by both installs so the dependency
 * tree (~631 MB) is downloaded once (#13974). It is never the host's cache, and `--backend copyfile` copies files out of
 * it, so the engine preparation that rewrites dist/modes/rpc/rpc-mode.js in place reaches neither cache (#13819).
 */
async function bunAddInIsolatedCache(consumer: string, args: readonly string[]): Promise<Step> {
  const cache = join(root, "bun-install-cache")
  const before = cacheEntries(cache)
  const result = await step(["bun", "add", "--backend", "copyfile", ...args, tarball], {
    cwd: consumer,
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: cache },
  })
  installs.push({ cache, added: cacheEntries(cache) - before })
  return result
}

function newConsumer(name: string): string {
  const consumer = join(root, name)
  mkdirSync(consumer, { recursive: true })
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "omo-ai-consumer", private: true }))
  return consumer
}

function installedSenpiRoot(installedPackageRoot: string): string | undefined {
  const consumerRequire = createRequire(join(installedPackageRoot, "package.json"))
  return (consumerRequire.resolve.paths("@code-yeongyu/senpi") ?? [])
    .map((searchPath) => join(searchPath, "@code-yeongyu", "senpi"))
    .find((candidate) => existsSync(join(candidate, "package.json")))
}

describe("omo-ai packed install", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "omo-ai-packed-install-"))
    const pack = await step(["bun", "pm", "pack", "--ignore-scripts", "--destination", root], { cwd: packageRoot })
    expect(pack.exitCode).toBe(0)
    const packed = [...new Bun.Glob("*.tgz").scanSync(root)][0]
    expect(packed).toBeDefined()
    tarball = join(root, packed!)
  }, 60_000)

  // Removing two copied install trees and their shared cache (~2 GB) outlasts the 40 s default hook bound on Windows.
  afterAll(() => {
    if (root !== "") rmSync(root, { recursive: true, force: true })
  }, STEP_BOUND_MS)

  test("ships the Senpi patch installer and installs a Senpi that surfaces pre-replay results natively", async () => {
    const listing = await step(["tar", "-tzf", tarball], { cwd: root })
    expect(listing.exitCode).toBe(0)
    const entries = listing.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((entry) => entry.replaceAll("/", sep))
    expect(entries).toContain(join("package", "bin", "senpi-patch.mjs"))

    const consumer = newConsumer("consumer-trusted")
    const install = await bunAddInIsolatedCache(consumer, ["--trust"])
    expect(install.exitCode).toBe(0)
    const installedPackageRoot = join(consumer, "node_modules", "omo-ai")
    const senpiRoot = installedSenpiRoot(installedPackageRoot)
    expect(senpiRoot).toBeDefined()
    const sessionRegistryPump = readFileSync(
      join(senpiRoot!, "dist/core/extensions/builtin/anthropic-subscription/session-registry-pump.js"),
      "utf8",
    )
    expect(sessionRegistryPump).toContain("sdkResultFailure(message)")

    // omo#8247: the ~255 MiB checker npm payload is deliberately absent from a native install. The
    // extension resolves it from plugin/extensions/omo.js, and that lookup walks the same node_modules
    // chain as the package root, so the miss is proven here without the staged plugin payload (which
    // build:omo-native produces; package-shape.test.ts pins the downloader in the source bundle).
    const extensionRequire = createRequire(join(installedPackageRoot, "plugin", "extensions", "omo.js"))
    expect(existsSync(join(installedPackageRoot, "node_modules", "@code-yeongyu", "comment-checker"))).toBe(false)
    expect(existsSync(join(consumer, "node_modules", "@code-yeongyu", "comment-checker"))).toBe(false)
    expect(() => extensionRequire.resolve("@code-yeongyu/comment-checker")).toThrow()
  }, 240_000)

  // #8713: with install scripts blocked (ignore-scripts=true, Bun's untrusted-postinstall default)
  // the first engine launch has to prepare the engine itself.
  test("prepares the engine on the first launch when install scripts never ran", async () => {
    const consumer = newConsumer("consumer-ignore-scripts")
    const home = join(root, "home")
    mkdirSync(home, { recursive: true })
    const install = await bunAddInIsolatedCache(consumer, ["--ignore-scripts"])
    expect(install.exitCode).toBe(0)
    const installedPackageRoot = join(consumer, "node_modules", "omo-ai")
    const senpiRoot = installedSenpiRoot(installedPackageRoot)
    expect(senpiRoot).toBeDefined()
    const rpcMode = join(senpiRoot!, "dist", "modes", "rpc", "rpc-mode.js")
    const stamp = join(senpiRoot!, ".omo-engine-prepared")
    // The stamp is the precondition: a hardlinked Bun cache can already carry a rewritten rpc-mode.js.
    expect(existsSync(stamp)).toBe(false)

    const launch = await step(["node", join(installedPackageRoot, "bin", "omo.js"), "--help"], {
      cwd: consumer,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OMO_RUNTIME: "node",
        OMO_CODING_AGENT_DIR: join(home, ".omo", "agent"),
      },
    })
    expect(launch.stderr).not.toContain("could not prepare the installed engine")
    expect(launch.exitCode).toBe(0)
    expect(readFileSync(rpcMode, "utf8")).toContain("invalid_stream_event")
    const omoVersion = JSON.parse(readFileSync(join(installedPackageRoot, "package.json"), "utf8")).version
    expect(readFileSync(stamp, "utf8").trim()).toBe(omoVersion)
  }, 240_000)

  // #13974: the dependency tree (~631 MB) is downloaded once per file; the second install reads the warm cache.
  test("downloads the dependency tree once for both installs", () => {
    expect(installs.length).toBe(2)
    expect(new Set(installs.map((install) => install.cache)).size).toBe(1)
    expect(installs[0]!.added).toBeGreaterThan(0)
    expect(installs[1]!.added).toBe(0)
  })
})
