import { spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { accessSync, chmodSync, constants, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import type { ReplaceBinary } from "./compiled-update"

export type VersionProbe = { readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: unknown }

export type SwapSteps = {
  readonly download: (url: string) => Promise<Uint8Array>
  readonly probeVersion: (path: string) => VersionProbe
  readonly writeExecutable: (path: string, bytes: Uint8Array, mode: number) => void
  readonly modeOf: (path: string) => number
  readonly assertWritableDir: (dir: string) => void
  readonly rename: (from: string, to: string) => void
  readonly remove: (path: string) => void
  readonly tempPath: (destination: string) => string
}

export type SwapRequest = {
  readonly url: string
  readonly checksumsUrl: string
  readonly asset: string
  readonly destination: string
  readonly platform: NodeJS.Platform
  readonly version: string
}

const SHA256_LINE = /^([0-9a-f]{64}) [ *](.+)$/

function checksumFor(sums: string, asset: string): string | undefined {
  for (const line of sums.split("\n")) {
    const match = SHA256_LINE.exec(line.trim())
    if (match !== null && match[2] === asset) return match[1]
  }
  return undefined
}

// Probe output is echoed into an error the terminal prints: keep one short line with no control characters.
const printable = (text: string): string => text.trim().split("\n")[0]?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 200) ?? ""

/**
 * Downloads the release, proves it against the release's published sha256 before anything touches the
 * disk, runs its `--version`, then swaps it in by rename (never overwriting a running executable). Any
 * failure leaves the installed binary in place; on win32 a failed second rename puts the old one back.
 */
export async function swapReleaseBinary(request: SwapRequest, steps: SwapSteps): Promise<void> {
  const { destination, platform, version } = request
  steps.assertWritableDir(dirname(destination))
  const expected = checksumFor(new TextDecoder().decode(await steps.download(request.checksumsUrl)), request.asset)
  if (expected === undefined) throw new Error(`the release lists no checksum for ${request.asset}`)
  const bytes = await steps.download(request.url)
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== expected) throw new Error(`the download does not match the published checksum for ${request.asset}`)
  const next = steps.tempPath(destination)
  try {
    steps.writeExecutable(next, bytes, steps.modeOf(destination))
    const probe = steps.probeVersion(next)
    if (probe.status !== 0 || !probe.stdout.startsWith(`omo ${version} `)) {
      throw new Error(`the downloaded binary did not report omo ${version} (${printable(probe.stdout || probe.stderr || String(probe.error ?? ""))})`)
    }
    if (platform !== "win32") {
      steps.rename(next, destination)
      return
    }
    const old = `${destination}.old`
    steps.remove(old)
    steps.rename(destination, old)
    try {
      steps.rename(next, destination)
    } catch (error) {
      steps.rename(old, destination)
      throw error
    }
  } finally {
    steps.remove(next)
  }
}

const nodeSwapSteps: SwapSteps = {
  download: async (url) => {
    const response = await fetch(url, { headers: { "User-Agent": "omo" }, signal: AbortSignal.timeout(600_000) })
    if (!response.ok) throw new Error(`${basename(new URL(url).pathname)} download answered ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },
  probeVersion: (path) => {
    // An inherited BUN_BE_BUN (exported by the `bun` CLI to its children) makes a compiled binary answer as bun.
    const { BUN_BE_BUN: _asBun, ...env } = process.env
    return spawnSync(path, ["--version"], { encoding: "utf8", env, timeout: 120_000, windowsHide: true })
  },
  writeExecutable: (path, bytes, mode) => {
    writeFileSync(path, bytes, { mode, flag: "wx" })
    chmodSync(path, mode)
  },
  modeOf: (path) => statSync(path).mode & 0o7777,
  assertWritableDir: (dir) => {
    try {
      accessSync(dir, constants.W_OK)
    } catch {
      throw new Error(`${dir} is not writable by this user, so the binary cannot be replaced here`)
    }
  },
  rename: renameSync,
  remove: (path) => rmSync(path, { force: true }),
  tempPath: (destination) => `${destination}.new-${randomBytes(6).toString("hex")}`,
}

export const downloadAndSwapBinary: ReplaceBinary = (url, destination, platform, version) =>
  swapReleaseBinary({
    url,
    checksumsUrl: `${url.slice(0, url.lastIndexOf("/"))}/SHA256SUMS`,
    asset: url.slice(url.lastIndexOf("/") + 1),
    destination,
    platform,
    version,
  }, nodeSwapSteps)
