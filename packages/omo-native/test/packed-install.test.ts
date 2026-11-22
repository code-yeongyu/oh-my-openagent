import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, sep } from "node:path"

const packageRoot = join(import.meta.dir, "..")
// Each step's absolute cap, inside the test's 240 s: a step never overruns the test budget (#13974).
const STEP_BOUND_MS = 200_000
// A step with a progress probe fails once STEP_STALL_MS passes with no measurable progress anywhere in
// this file's run root: that is a hung install (a blackholed registry, a dead postinstall), not a slow
// one. Watching work instead of wall clock keeps a loaded runner's slower-but-progressing install from
// being a false red; the absolute cap above still bounds the test's budget and names the last progress.
const STEP_STALL_MS = 90_000
const PROBE_INTERVAL_MS = 15_000

/** A signature of all filesystem work under the run root: entry count and total bytes. */
function runRootProgress(rootDir: string): () => string {
  return () => {
    let entries = 0
    let bytes = 0
    const walk = (dir: string): void => {
      let listing
      try {
        listing = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of listing) {
        entries += 1
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else {
          try {
            bytes += statSync(path).size
          } catch {
            // A file replaced mid-walk reads as zero progress for one sample; never a crash.
          }
        }
      }
    }
    walk(rootDir)
    return "entries=" + entries + " bytes=" + bytes
  }
}

type Step = { readonly exitCode: number; readonly stdout: string; readonly stderr: string }

/**
 * Runs one command and awaits its exit. Without a probe it fails at the absolute cap. With one, it
 * also fails - sooner - once the probe shows no progress for STEP_STALL_MS, and every failure names
 * the last observed progress so a red under load carries its own evidence (#12246).
 */
async function step(
  cmd: readonly string[],
  options: { cwd: string; env?: Record<string, string | undefined>; progress?: () => string },
): Promise<Step> {
  const proc = Bun.spawn([...cmd], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const probe = options.progress
  let lastProgress = probe?.() ?? ""
  let lastProgressAt = Date.now()
  let stalledForMs = 0
  let probeTimer: ReturnType<typeof setInterval> | undefined
  if (probe !== undefined) {
    probeTimer = setInterval(() => {
      const current = probe()
      if (current !== lastProgress) {
        lastProgress = current
        lastProgressAt = Date.now()
        return
      }
      const quietForMs = Date.now() - lastProgressAt
      if (quietForMs >= STEP_STALL_MS) {
        stalledForMs = quietForMs
        proc.kill()
      }
    }, PROBE_INTERVAL_MS)
  }
  const progressNote = probe === undefined ? "" : "; last progress " + lastProgress
  let bound: ReturnType<typeof setTimeout> | undefined
  const overran = new Promise<never>((_, reject) => {
    bound = setTimeout(() => {
      proc.kill()
      reject(new Error(cmd.join(" ") + " did not exit within " + STEP_BOUND_MS + " ms" + progressNote))
    }, STEP_BOUND_MS)
  })
  try {
    const [exitCode, stdout, stderr] = await Promise.race([
      Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]),
      overran,
    ])
    if (stalledForMs > 0) {
      throw new Error(
        cmd.join(" ") +
          " made no progress for " +
          stalledForMs +
          " ms (last progress " +
          lastProgress +
          "); stderr: " +
          stderr.slice(0, 2_000),
      )
    }
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(bound)
    if (probeTimer !== undefined) clearInterval(probeTimer)
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
  // bun stages package extraction in TMPDIR. Pointed at the shared OS temp dir, a killed install
  // leaves an unowned staging directory behind (#9766); inside the run root, afterAll removes it on
  // every path, kill included.
  const staging = join(root, "staging", basename(consumer))
  mkdirSync(staging, { recursive: true })
  const result = await step(["bun", "add", "--backend", "copyfile", ...args, tarball], {
    cwd: consumer,
    env: {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: cache,
      TMPDIR: staging,
      TMP: staging,
      TEMP: staging,
    },
    progress: runRootProgress(root),
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
      progress: runRootProgress(root),
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
