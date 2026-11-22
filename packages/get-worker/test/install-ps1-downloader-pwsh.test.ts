import { afterEach, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startFixtureServer, stopFixtureServer, type FixtureServer } from "./install-fixture-server"

/**
 * install.ps1 downloader executed under real PowerShell (#12344). The harness extracts the real
 * Invoke-OmoFetch and Get-OmoFileSize bodies from install.ps1 and runs them inside a pwsh whose
 * PATH has no curl.exe, so the .NET streaming fallback is the downloader under test; the fixtures
 * fault it with a stalled and a still-progressing transfer and a redirecting size lookup.
 *
 * pwsh is absent on this Linux CI lane (get-worker-ci.yml `worker` runs on ubuntu without pwsh on
 * PATH), so these skip here; they execute on any host that has pwsh (Windows runners, dev boxes)
 * and mirror the curl-side replay in install-ps1-fetch-stall.test.ts.
 */

const script = readFileSync(join(import.meta.dir, "..", "scripts", "install.ps1"), "utf8")

const pwshProbe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
  encoding: "utf8",
  timeout: 10_000,
})
const hasPwsh = pwshProbe.status === 0

/** Inactivity window substituted for the shipped 60 s so the test stays fast; same semantics. */
const TEST_IDLE_MS = "2000"
const PWSH_CIRCUIT_BREAKER_MS = 30_000
const SLOW_FIXTURE = { slowBytes: 1_572_864, slowChunkBytes: 25_600, slowIntervalMs: 100 } // ~250 KB/s

function downloaderFunctions(): string {
  const start = script.indexOf("function Invoke-OmoFetch")
  const end = script.indexOf("function Resolve-OmoVersion", start)
  if (start < 0 || end < 0) throw new Error("install.ps1 has no Invoke-OmoFetch / Resolve-OmoVersion boundary")
  return script
    .slice(start, end)
    .replace(/60000/g, TEST_IDLE_MS)
}

function writeHarness(root: string): { harness: string; isolatedPathDir: string } {
  const isolatedPathDir = join(root, "no-curl-on-path")
  mkdirSync(isolatedPathDir, { recursive: true })
  const harness = join(root, "harness.ps1")
  const program = [
    "param([string]$Mode, [string]$Url, [string]$OutFile)",
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$UserAgent = 'omo-install-test'",
    "$GitHubDownload = 'http://127.0.0.1:1/unused'",
    'function Write-OmoSay([string]$Message) { Write-Output "SAY $Message" }',
    'function Stop-OmoInstall([string]$Message) { throw "STOP $Message" }',
    downloaderFunctions(),
    "$env:PATH = $env:HARNESS_PATH",
    "try {",
    "  if ($Mode -eq 'size') { Write-Output (\"SIZE \" + (Get-OmoFileSize '1.0.0' 'asset' $Url)) }",
    "  else { Invoke-OmoFetch $Url $OutFile; Write-Output 'FETCH-OK' }",
    "} catch {",
    "  Write-Output (\"FETCH-FAIL \" + $_.Exception.Message)",
    "  exit 1",
    "}",
  ].join("\n")
  writeFileSync(harness, program)
  return { harness, isolatedPathDir }
}

type PwshRun = { code: number | null; breakerFired: boolean; output: string; elapsedMs: number }

function runHarness(harness: string, args: string[], isolatedPathDir: string): Promise<PwshRun> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-File", harness, ...args], {
      env: { ...process.env, HARNESS_PATH: isolatedPathDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (data) => {
      output += String(data)
    })
    child.stderr.on("data", (data) => {
      output += String(data)
    })
    let breakerFired = false
    const breaker = setTimeout(() => {
      breakerFired = true
      child.kill("SIGKILL")
    }, PWSH_CIRCUIT_BREAKER_MS)
    child.on("error", (error) => {
      clearTimeout(breaker)
      resolve({ code: null, breakerFired, output: `${output}${String(error)}`, elapsedMs: Date.now() - startedAt })
    })
    child.on("close", (code) => {
      clearTimeout(breaker)
      resolve({ code, breakerFired, output, elapsedMs: Date.now() - startedAt })
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

describe("install.ps1 Invoke-OmoFetch executed under pwsh (#12344)", () => {
  test.skipIf(!hasPwsh)("the streaming fallback aborts a stalled transfer on inactivity with the stall message", async () => {
    fixture = await startFixtureServer(SLOW_FIXTURE)
    const root = mkdtempSync(join(tmpdir(), "omo-ps1-pwsh-"))
    roots.push(root)
    const { harness, isolatedPathDir } = writeHarness(root)
    const outFile = join(root, "stalled.out")
    const result = await runHarness(harness, ["-Mode", "fetch", "-Url", `${fixture.origin}/stall`, "-OutFile", outFile], isolatedPathDir)
    expect(
      result.breakerFired,
      `the fallback downloader outlived ${PWSH_CIRCUIT_BREAKER_MS} ms against a stalled transfer:\n${result.output}`,
    ).toBe(false)
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/FETCH-FAIL .*stalled/)
    expect(result.elapsedMs, "the idle window must actually elapse before the abort").toBeGreaterThan(
      Number(TEST_IDLE_MS) - 500,
    )
    expect(result.elapsedMs).toBeLessThan(15_000)
  })

  test.skipIf(!hasPwsh)("the streaming fallback completes a progressing transfer and emits byte-progress notes", async () => {
    fixture = await startFixtureServer(SLOW_FIXTURE)
    const root = mkdtempSync(join(tmpdir(), "omo-ps1-pwsh-"))
    roots.push(root)
    const { harness, isolatedPathDir } = writeHarness(root)
    const outFile = join(root, "slow.out")
    const result = await runHarness(harness, ["-Mode", "fetch", "-Url", `${fixture.origin}/slow`, "-OutFile", outFile], isolatedPathDir)
    expect(result.breakerFired).toBe(false)
    expect(result.output).toContain("FETCH-OK")
    expect(result.output, "progress must be visible during the body transfer").toMatch(/SAY\s+\d+(\.\d+)? of \d+(\.\d+)? MB received/)
    expect(readFileSync(outFile, "utf8").length).toBe(SLOW_FIXTURE.slowBytes)
  })

  test.skipIf(!hasPwsh)("the size lookup follows the redirect to the final asset's length", async () => {
    fixture = await startFixtureServer(SLOW_FIXTURE)
    const root = mkdtempSync(join(tmpdir(), "omo-ps1-pwsh-"))
    roots.push(root)
    const { harness, isolatedPathDir } = writeHarness(root)
    const result = await runHarness(harness, ["-Mode", "size", "-Url", `${fixture.origin}/r`], isolatedPathDir)
    expect(result.breakerFired).toBe(false)
    expect(result.output).toContain("SIZE 123456")
  })
})
