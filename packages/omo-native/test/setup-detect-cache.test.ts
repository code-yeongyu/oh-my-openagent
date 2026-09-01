import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  CACHE_FILENAME,
  CACHE_VERSION,
  SETUP_SUGGESTION_TTL_MS,
  readSetupSuggestionCache,
  setupDetectInputStats,
} from "../bin/lib/setup-detect-cache.js"

// The launcher answers the interactive banner's sibling-credential hint from a small cache instead
// of blocking on live detection. These tests pin that contract through the real surfaces: the
// synchronous reader (unit), and full launcher runs on a real pty for the spawn/refresh lifecycle.
// Live detection itself stays pinned by setup-detect.test.ts; doctor and setup must keep ignoring
// the cache entirely.

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const TTY_DRIVER = resolve(fileURLToPath(new URL("tty-driver.py", import.meta.url)))
const roots: string[] = []

type Fixture = {
  root: string
  home: string
  agentDir: string
  xdg: string
  launcher: string
  captureFile: string
  cachePath: string
  env: NodeJS.ProcessEnv
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-suggest-cache-"))
  roots.push(root)
  const home = join(root, "home")
  const agentDir = join(root, "senpi-agent")
  const xdg = join(root, "xdg")
  mkdirSync(home, { recursive: true })
  const packageRoot = join(root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  write(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai", version: "1.2.3-test.0", type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  write(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" },
  }))
  write(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  // The fake engine records its spawn, so a launch that never blocked on detection can still prove
  // the engine ran.
  write(join(senpiRoot, "dist", "cli.js"), `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_FILE, "spawned")
process.exit(0)
`)
  write(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  for (const artifact of [
    "plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js",
    "plugin/runtime/agent-toolkit/cli.js",
  ]) write(join(packageRoot, artifact), "fixture\n")
  const env = { HOME: home, SENPI_CODING_AGENT_DIR: agentDir, XDG_DATA_HOME: xdg }
  return {
    root,
    home,
    agentDir,
    xdg,
    launcher: join(packageRoot, "bin", "omo.js"),
    captureFile: join(root, "capture.txt"),
    cachePath: join(agentDir, CACHE_FILENAME),
    env,
  }
}

function runLauncher(fixture: Fixture, args: string[], tty = false) {
  // A developer machine exports the agent directory for its own install; an inherited OMO_* value
  // would outrank the fixture's SENPI_* override and answer with real machine state.
  // launcher.test.ts defends the same way.
  const inherited: NodeJS.ProcessEnv = { ...process.env, CAPTURE_FILE: fixture.captureFile }
  delete inherited.OMO_CODING_AGENT_DIR
  delete inherited.PI_CODING_AGENT_DIR
  const env = { ...inherited, ...fixture.env }
  const result = !tty
    ? spawnSync(process.execPath, [fixture.launcher, ...args], { encoding: "utf8", env })
    : spawnSync("python3", [TTY_DRIVER, "", "", process.execPath, fixture.launcher, ...args], { encoding: "utf8", env })
  if (result.error) throw result.error
  return result
}

function cacheContents(fixture: Fixture): Record<string, unknown> | undefined {
  if (!existsSync(fixture.cachePath)) return undefined
  return JSON.parse(readFileSync(fixture.cachePath, "utf8"))
}

function freshEntry(fixture: Fixture, suggestion: boolean, writtenAt = Date.now()) {
  return {
    version: CACHE_VERSION,
    writtenAt,
    inputs: setupDetectInputStats(fixture.env, fixture.home),
    suggestion,
  }
}

/**
 * Awaits the refresh child's cache rewrite by polling the exact observable it produces - the cache
 * file's contents - with a bounded deadline. The refresh child is detached and unref'd by contract,
 * so there is no exit event to subscribe to; the rewritten file IS the signal.
 */
async function waitForCache(
  fixture: Fixture,
  predicate: (entry: Record<string, unknown>) => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const entry = cacheContents(fixture)
    if (entry !== undefined && predicate(entry)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`waited 15s for ${description}; cache is ${JSON.stringify(cacheContents(fixture))}`)
}

/** One sibling credential store the suggestion fires on, with no engine credentials of its own. */
function installSibling(fixture: Fixture, content = "{}") {
  write(join(fixture.xdg, "opencode", "auth.json"), content)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("setup suggestion cache", () => {
  describe("#given a cache entry shaped like the refresh child writes it", () => {
    test("#when the inputs are unchanged #then the read is fresh and answers the cached suggestion", () => {
      const fixture = createFixture()
      installSibling(fixture)
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, true))}\n`)
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual({ suggestion: true, fresh: true })
    })

    test("#when an input changed after the entry was written #then the read is stale but keeps the cached suggestion", () => {
      const fixture = createFixture()
      installSibling(fixture)
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, true))}\n`)
      installSibling(fixture, '{"changed":true}')
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual({ suggestion: true, fresh: false })
    })

    test("#when the entry is older than the TTL #then the read is stale but keeps the cached suggestion", () => {
      const fixture = createFixture()
      installSibling(fixture)
      const expired = Date.now() - SETUP_SUGGESTION_TTL_MS - 1
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, true, expired))}\n`)
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual({ suggestion: true, fresh: false })
    })

    test("#when the entry is exactly at the TTL boundary #then the read is still fresh", () => {
      const fixture = createFixture()
      installSibling(fixture)
      const writtenAt = Date.now() - 60_000
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, false, writtenAt))}\n`)
      // An explicit clock pins the boundary: age exactly equal to the TTL is still fresh, one
      // millisecond past it is stale.
      expect(readSetupSuggestionCache(fixture.env, fixture.home, writtenAt + SETUP_SUGGESTION_TTL_MS))
        .toEqual({ suggestion: false, fresh: true })
      expect(readSetupSuggestionCache(fixture.env, fixture.home, writtenAt + SETUP_SUGGESTION_TTL_MS + 1))
        .toEqual({ suggestion: false, fresh: false })
    })
  })

  describe("#given an unusable cache", () => {
    test("#when read #then every shape misses without throwing and behaves as no-siblings", () => {
      const fixture = createFixture()
      installSibling(fixture)
      const miss = { suggestion: undefined, fresh: false }
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual(miss)
      write(fixture.cachePath, "{ not-json\n")
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual(miss)
      write(fixture.cachePath, `${JSON.stringify({ ...freshEntry(fixture, true), version: CACHE_VERSION - 1 })}\n`)
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual(miss)
      write(fixture.cachePath, `${JSON.stringify({ version: CACHE_VERSION, writtenAt: Date.now() })}\n`)
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual(miss)
      write(fixture.cachePath, `${JSON.stringify({ ...freshEntry(fixture, true), suggestion: "yes" })}\n`)
      expect(readSetupSuggestionCache(fixture.env, fixture.home)).toEqual(miss)
    })
  })

  describe("#given a fresh cache", () => {
    test.skipIf(process.platform === "win32")("#when an interactive launch runs #then the hint appears and the launcher never rewrites the cache", () => {
      const fixture = createFixture()
      installSibling(fixture)
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, true))}\n`)
      const before = readFileSync(fixture.cachePath, "utf8")

      const result = runLauncher(fixture, [], true)

      expect(result.status).toBe(0)
      const output = `${result.stdout}${result.stderr}`
      expect(output.match(/sibling credentials detected; run `omo setup`/g)?.length).toBe(1)
      expect(readFileSync(fixture.cachePath, "utf8")).toBe(before)
      expect(readFileSync(fixture.captureFile, "utf8")).toBe("spawned")
      expect(readdirSync(fixture.agentDir).sort()).toEqual([CACHE_FILENAME])
    })
  })

  describe("#given no cache at all", () => {
    test.skipIf(process.platform === "win32")("#when an interactive launch runs #then it never blocks, prints no hint, and the detached refresh writes the cache", async () => {
      const fixture = createFixture()
      installSibling(fixture)

      const cold = runLauncher(fixture, [], true)

      expect(cold.status).toBe(0)
      expect(`${cold.stdout}${cold.stderr}`).not.toContain("sibling credentials detected")
      expect(readFileSync(fixture.captureFile, "utf8")).toBe("spawned")
      await waitForCache(fixture, (entry) => entry.version === CACHE_VERSION && entry.suggestion === true,
        "the detached refresh child to write the cache")

      const warm = runLauncher(fixture, [], true)
      const output = `${warm.stdout}${warm.stderr}`
      expect(warm.status).toBe(0)
      expect(output.match(/sibling credentials detected; run `omo setup`/g)?.length).toBe(1)
      expect(readdirSync(fixture.agentDir).sort()).toEqual([CACHE_FILENAME])
    })

    test("#when a non-interactive launch runs #then no cache is created", () => {
      const fixture = createFixture()
      installSibling(fixture)
      const result = runLauncher(fixture, [])
      expect(result.status).toBe(0)
      expect(`${result.stdout}${result.stderr}`).not.toContain("sibling credentials detected")
      expect(existsSync(fixture.cachePath)).toBe(false)
    })
  })

  describe("#given a cache whose fingerprint no longer matches", () => {
    test.skipIf(process.platform === "win32")("#when an interactive launch runs #then this launch answers from the cache and the refresh child rewrites it", async () => {
      const fixture = createFixture()
      installSibling(fixture)
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, true))}\n`)
      installSibling(fixture, '{"changed":true}')
      const before = readFileSync(fixture.cachePath, "utf8")

      const stale = runLauncher(fixture, [], true)

      expect(stale.status).toBe(0)
      const output = `${stale.stdout}${stale.stderr}`
      expect(output.match(/sibling credentials detected; run `omo setup`/g)?.length).toBe(1)
      expect(readFileSync(fixture.captureFile, "utf8")).toBe("spawned")
      const current = JSON.stringify(setupDetectInputStats(fixture.env, fixture.home))
      await waitForCache(fixture, (entry) => JSON.stringify(entry.inputs) === current && entry.suggestion === true,
        "the detached refresh child to rewrite the cache for the changed inputs")
      expect(readFileSync(fixture.cachePath, "utf8")).not.toBe(before)
    })
  })

  describe("#given a warm cache that disagrees with live state", () => {
    test("#when doctor runs #then it answers from live detection and leaves the cache alone", () => {
      const fixture = createFixture()
      installSibling(fixture)
      // Live state has no engine credentials and a sibling installed, so the live suggestion is
      // true; the cache claims the opposite while staying fingerprint-fresh.
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, false))}\n`)
      const before = readFileSync(fixture.cachePath, "utf8")

      const result = runLauncher(fixture, ["doctor"])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain("INFO no credentials found; run omo setup to review sibling stores")
      expect(readFileSync(fixture.cachePath, "utf8")).toBe(before)
    })

    test("#when setup runs #then it reports live harnesses and never reads the cached suggestion", () => {
      const fixture = createFixture()
      installSibling(fixture, JSON.stringify({ "open-api": { type: "api", key: "OPENCODE-SECRET" } }))
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, false))}\n`)

      const result = runLauncher(fixture, ["setup"])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain("opencode | yes | open-api | api | none")
      expect(result.stdout).toContain("senpi | no | none | none |")
    })

    test("#when the cache claims a suggestion live state cannot support #then doctor stays silent", () => {
      const fixture = createFixture()
      installSibling(fixture)
      // Engine credentials exist, so live detection has nothing to suggest.
      write(join(fixture.agentDir, "auth.json"), JSON.stringify({ senpi: { type: "api_key", key: "SENPI-SECRET" } }))
      write(fixture.cachePath, `${JSON.stringify(freshEntry(fixture, true))}\n`)

      const result = runLauncher(fixture, ["doctor"])

      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain("INFO no credentials found")
    })
  })
})
