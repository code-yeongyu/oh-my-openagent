import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startFixtureServer, stopFixtureServer, type FixtureServer } from "./install-fixture-server"

/**
 * install.ps1 downloader stall contract (#12344): a transfer with no progress must abort within
 * the stall window while a slow but progressing transfer completes, and the pre-download size
 * lookup must report the final asset behind redirects.
 *
 * This host has no PowerShell, so the behavioral half executes the exact curl argument lists
 * Invoke-OmoFetch and Get-OmoFileSize ship (Windows 10+ always runs curl.exe through those
 * lines) against a local fixture server. The structural half pins the PowerShell-only pieces
 * of the same contract whose executor is a host with pwsh (see install-ps1-downloader-pwsh.test.ts
 * for the executed variant of the fallback path).
 */

const script = readFileSync(join(import.meta.dir, "..", "scripts", "install.ps1"), "utf8")

function invokeOmoFetchSource(): string {
  const start = script.indexOf("function Invoke-OmoFetch")
  const end = script.indexOf("function Resolve-OmoVersion", start)
  if (start < 0 || end < 0) throw new Error("install.ps1 has no Invoke-OmoFetch / Resolve-OmoVersion boundary")
  return script.slice(start, end)
}

/** Stall window used in place of the shipped 1 KB/s-for-60 s so the test stays fast; same semantics, smaller numbers. */
const TEST_SPEED_LIMIT = "50"
const TEST_SPEED_TIME = "1"
const STALL_CIRCUIT_BREAKER_MS = 15_000
const SLOW_FIXTURE = { slowBytes: 65_536, slowChunkBytes: 2048, slowIntervalMs: 50 } // ~40 KB/s

type CurlArgs = { argv: string[]; hasStallBound: boolean }

function tokenizeCurlLine(line: string): string[] {
  return line
    .replace(/^\s*\$\w+\s*=\s*&\s*\$curl\.Path\s*/, "")
    .replace(/2>(&1|\$null)\s*$/, "")
    .trim()
    .split(/\s+/)
}

function substituteTokens(shipped: string[], url: string, outFile: string | null): { argv: string[]; hasStallBound: boolean } {
  const argv: string[] = []
  let hasStallBound = false
  for (let i = 0; i < shipped.length; i += 1) {
    const token = shipped[i]
    if (token === undefined) break
    if (token === "--proto") {
      i += 1 // fixture server speaks plain HTTP; the protocol pin is orthogonal to the stall bound
      continue
    }
    if (token === "--speed-limit") {
      argv.push("--speed-limit", TEST_SPEED_LIMIT)
      i += 1
      hasStallBound = true
      continue
    }
    if (token === "--speed-time") {
      argv.push("--speed-time", TEST_SPEED_TIME)
      i += 1
      hasStallBound = true
      continue
    }
    if (token === "$Url" || token === "$url") {
      argv.push(url)
      continue
    }
    if (token === "$OutFile" && outFile !== null) {
      argv.push(outFile)
      continue
    }
    if (token === "$UserAgent") {
      argv.push("omo-install-test")
      continue
    }
    argv.push(token.replace(/^'|'$/g, ""))
  }
  return { argv, hasStallBound }
}

function extractGetCurlArgs(source: string, url: string, outFile: string): CurlArgs {
  const line = source.split(/\r?\n/).find((l) => l.includes("-fsSL"))
  if (line === undefined) throw new Error("Invoke-OmoFetch has no curl invocation line")
  const { argv, hasStallBound } = substituteTokens(tokenizeCurlLine(line), url, outFile)
  return { argv, hasStallBound }
}

function extractHeadCurlArgs(source: string, url: string): string[] {
  const line = source
    .split(/\r?\n/)
    .find((l) => l.includes("-fsSI") && l.includes("$curl.Path"))
  if (line === undefined) throw new Error("Get-OmoFileSize has no curl HEAD invocation line")
  const { argv } = substituteTokens(tokenizeCurlLine(line), url, null)
  return argv
}

type CurlResult = { code: number | null; breakerFired: boolean; stdout: string; stderr: string }

function runCurl(argv: string[]): Promise<CurlResult> {
  return new Promise((resolve) => {
    const child = spawn("curl", argv, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (data) => {
      stdout += String(data)
    })
    child.stderr.on("data", (data) => {
      stderr += String(data)
    })
    let breakerFired = false
    const breaker = setTimeout(() => {
      breakerFired = true
      child.kill("SIGKILL")
    }, STALL_CIRCUIT_BREAKER_MS)
    child.on("error", (error) => {
      clearTimeout(breaker)
      resolve({ code: null, breakerFired, stdout, stderr: `${stderr}${String(error)}` })
    })
    child.on("close", (code) => {
      clearTimeout(breaker)
      resolve({ code, breakerFired, stdout, stderr })
    })
  })
}

const roots: string[] = []
let fixture: FixtureServer | undefined

afterEach(() => {
  stopFixtureServer(fixture)
  fixture = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("install.ps1 Invoke-OmoFetch curl arguments (#12344)", () => {
  test("abort a transfer with no progress inside the stall window", async () => {
    fixture = await startFixtureServer(SLOW_FIXTURE)
    const root = mkdtempSync(join(tmpdir(), "omo-ps1-stall-"))
    roots.push(root)
    const outFile = join(root, "stalled.out")
    const { argv, hasStallBound } = extractGetCurlArgs(invokeOmoFetchSource(), `${fixture.origin}/stall`, outFile)
    const result = await runCurl(argv)
    expect(
      result.breakerFired,
      `the shipped curl arguments ${hasStallBound ? "carry a stall bound that did not fire" : "carry no stall bound (--speed-limit/--speed-time missing)"}; the stalled transfer outlived ${STALL_CIRCUIT_BREAKER_MS} ms`,
    ).toBe(false)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("28")
  })

  test("complete a slow but progressing transfer under the same arguments", async () => {
    fixture = await startFixtureServer(SLOW_FIXTURE)
    const root = mkdtempSync(join(tmpdir(), "omo-ps1-slow-"))
    roots.push(root)
    const outFile = join(root, "slow.out")
    const { argv } = extractGetCurlArgs(invokeOmoFetchSource(), `${fixture.origin}/slow`, outFile)
    const result = await runCurl(argv)
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    expect(readFileSync(outFile, "utf8").length).toBe(SLOW_FIXTURE.slowBytes)
  })
})

describe("install.ps1 size HEAD curl arguments (#12344)", () => {
  test("follow the redirect chain so the reported size is the final asset's", async () => {
    fixture = await startFixtureServer(SLOW_FIXTURE)
    const argv = extractHeadCurlArgs(script, `${fixture.origin}/r302`)
    const result = await runCurl(argv)
    expect(result.code).toBe(0)
    const lengths = [...result.stdout.matchAll(/^content-length:\s*(\d+)/gim)].map((m) => m[1])
    expect(
      lengths.length,
      `no final-asset length in HEAD output; the mirror's redirect answered instead:\n${result.stdout}`,
    ).toBeGreaterThan(0)
    expect(lengths[lengths.length - 1]).toBe("123456")
  })
})

describe("install.ps1 downloader contracts only PowerShell can execute (#12344)", () => {
  // Retention bar: each check guards a platform/cross-language contract of the shipped installer
  // text; on hosts without pwsh these are the only runnable guard, the pwsh module owns execution.

  test("maps curl's stall exit code to a message that names the stall", () => {
    const stallBranch = invokeOmoFetchSource()
      .split(/\r?\n/)
      .find((l) => l.includes("$code -eq 28"))
    expect(stallBranch).toBeDefined()
    expect(stallBranch ?? "").toMatch(/throw.*stall/i)
  })

  test("streams the curl-less fallback with an inactivity bound, not a total cutoff", () => {
    const source = invokeOmoFetchSource()
    const fallbackStart = source.indexOf("[Net.HttpWebRequest]")
    const fallbackEnd = source.indexOf("function Get-OmoFileSize")
    expect(fallbackStart, "fallback must stream over HttpWebRequest").toBeGreaterThanOrEqual(0)
    expect(fallbackEnd).toBeGreaterThan(fallbackStart)
    const fallback = source.slice(fallbackStart, fallbackEnd)
    expect(fallback).toMatch(/ReadAsync/)
    expect(fallback).toMatch(/ElapsedMilliseconds/)
    expect(fallback, "an idle read past the window must abort with a stall message").toMatch(/stalled/)
    expect(fallback, "a total-duration cutoff would kill the healthy ~144 kbps case").not.toMatch(/TimeoutSec/)
    expect(fallback, "progress must be visible during the body transfer").toMatch(/MB received/)
  })

  test("prints the asset name and size before the asset download starts", () => {
    const lines = script.split(/\r?\n/)
    const sizeHelper = lines.findIndex((l) => l.includes("function Get-OmoFileSize"))
    const announcing = lines.findIndex((l) => /Write-OmoSay.*Downloading \$asset/.test(l))
    const assetCall = lines.findIndex((l) => /Save-OmoReleaseFile \$version \$asset/.test(l))
    expect(sizeHelper, "a size lookup helper must exist").toBeGreaterThanOrEqual(0)
    expect(announcing, "a Downloading line must interpolate the asset name").toBeGreaterThanOrEqual(0)
    expect(assetCall, "the asset download call must exist").toBeGreaterThan(announcing)
    const before = lines.slice(Math.max(0, announcing - 3), announcing).join("\n")
    expect(before, "the size must be computed before the Downloading line prints").toMatch(/\$size/i)
    expect(lines.some((l) => l.includes("size unavailable")), "an unanswerable size must be said honestly").toBe(true)
  })

  test("bounds the --version smoke check and says why a first run can wait", () => {
    const lines = script.split(/\r?\n/)
    const bounded = lines.findIndex((l) => /\.WaitForExit\(\d+\)/.test(l))
    expect(bounded).toBeGreaterThanOrEqual(0)
    const before = lines.slice(Math.max(0, bounded - 8), bounded).join("\n")
    expect(before).toMatch(/first run|antivirus/i)
  })

  test("the progress-mode curl invocation carries the same stall bound", () => {
    const progressLine = script
      .split(/\r?\n/)
      .find((l) => l.includes("--progress-bar") && l.includes("$curl.Path"))
    expect(progressLine).toBeDefined()
    expect(progressLine ?? "").toContain("--speed-limit")
    expect(progressLine ?? "").toContain("--speed-time")
  })
})
