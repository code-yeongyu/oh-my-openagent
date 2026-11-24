import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { access, chmod, constants, link, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"
import { acquireBinaryUpdateLock, BINARY_UPDATE_TIMEOUT_MS } from "./compiled-update-lock"

// omo-ai publishes `5.0.0-0.beta.90` while its GitHub release is tagged `v5.0.0-beta.90`.
export function releaseVersionOf(omoAiVersion: string): string {
  return omoAiVersion.replace(/^(\d+\.\d+\.\d+)-0\.(.+)$/, "$1-$2")
}

export type BinaryUpdateCode =
  | "directory_not_writable"
  | "update_in_progress"
  | "download_failed"
  | "integrity_failed"
  | "verification_failed"
  | "install_failed"
  | "rollback_failed"

export class BinaryUpdateError extends Error {
  override readonly name = "BinaryUpdateError"
  constructor(
    readonly code: BinaryUpdateCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export type BinaryInstallRequest = {
  readonly destination: string
  readonly asset: string
  readonly version: string
  readonly platform: NodeJS.Platform
}
type Run = (file: string, args: readonly string[]) => Promise<{ readonly code: number; readonly stdout: string }>
type FetchAsset = (url: string) => Promise<Response>

const execute = promisify(execFile)
const run: Run = async (file, args) => {
  const env = { ...process.env }
  // A release probe must boot that release, not inherit the old runtime's identity or Bun CLI mode.
  for (const key of [
    "BUN_BE_BUN",
    "OMO_PROVISIONED_HANDOFF",
    "OMO_PROVISIONED_LAUNCHER",
    "OMO_PACKAGE_DIR",
    "SENPI_PACKAGE_DIR",
  ])
    delete env[key]
  const result = await execute(file, [...args], { env, encoding: "utf8", timeout: 120_000, windowsHide: true })
  return { code: 0, stdout: result.stdout }
}

const fetchAsset = (url: string, deadline: AbortSignal): Promise<Response> =>
  fetch(url, {
    headers: { "User-Agent": "omo" },
    signal: AbortSignal.any([deadline, AbortSignal.timeout(600_000)]),
  })

async function download(version: string, asset: string, fetchAsset: FetchAsset): Promise<Response> {
  const bases = ["https://get.omo.dev/v", "https://github.com/code-yeongyu/oh-my-openagent/releases/download"]
  let cause: unknown
  for (const base of bases) {
    const tag = base.endsWith("/download") ? `v${version}` : version
    try {
      const response = await fetchAsset(`${base}/${tag}/${asset}`)
      if (response.ok) return response
      await response.body?.cancel()
      cause = new Error(`HTTP ${response.status}`)
    } catch (error) {
      cause = error
    }
  }
  throw new BinaryUpdateError("download_failed", `could not download ${asset} ${version}`, { cause })
}

/**
 * Remove stale `.new-*` and `.old-*` staging files left by a previous update that
 * failed during cleanup. On Windows, a held or corrupted staging file can produce
 * errors (EFAULT, EBUSY) that block the next update before it starts. Sweeping
 * them first is safe: a UUID-named file can never be the current binary.
 */
async function sweepStaleArtifacts(destination: string, platform: NodeJS.Platform): Promise<void> {
  const directory = dirname(destination)
  const prefix = basename(destination)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return
  }
  const stale = entries.filter(
    (entry) =>
      entry.startsWith(`${prefix}.new-`) || entry.startsWith(`${prefix}.old-`) || entry === `${prefix}.new`,
  )
  for (const entry of stale) {
    const path = join(directory, entry)
    try {
      await rm(path, { force: true })
    } catch (error) {
      // Windows may keep a handle open after a rename of a loaded executable.
      // EFAULT can surface when the OS or AV holds a dangling kernel reference.
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (platform === "win32" && /^(EPERM|EBUSY|EACCES|EFAULT)$/.test(code)) continue
      // A missing file (concurrent cleaner already removed it) is fine.
      if (code === "ENOENT") continue
    }
  }
}

// Retry budget for Windows rename during swap: a held executable (running omo, AV scan)
// can fail with EBUSY/EPERM/EACCES. 15 attempts with escalating delays ≈ 35s total.
const SWAP_RETRY_DELAYS = [1000, 1000, 1000, 1000, 1000, 2000, 2000, 2000, 2000, 2000, 4000, 4000, 4000, 4000, 4000]
const SWAP_TASKKILL_ATTEMPT = 8
const SWAP_RETRY_CODES = /^(EPERM|EBUSY|EACCES)$/

async function retryRename(from: string, to: string, binaryName: string, platform: NodeJS.Platform): Promise<void> {
  if (platform !== "win32") {
    await rename(from, to)
    return
  }
  for (let attempt = 0; attempt < SWAP_RETRY_DELAYS.length; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (!SWAP_RETRY_CODES.test(code) || attempt === SWAP_RETRY_DELAYS.length - 1) throw error
      if (attempt === SWAP_TASKKILL_ATTEMPT) {
        try {
          await execFile("taskkill.exe", ["/F", "/IM", binaryName], { windowsHide: true })
        } catch {
          /* best-effort — the process may have already exited */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, SWAP_RETRY_DELAYS[attempt]))
    }
  }
}

/**
 * Refresh `~/.omo/install.json` so the install receipt stays accurate after an
 * in-process binary update. Best-effort: failures are silently ignored so they
 * never affect the update result.
 */
export async function refreshInstallManifest(
  destination: string,
  version: string,
  asset?: string,
  homeDir: string = homedir(),
): Promise<void> {
  const manifestPath = join(homeDir, ".omo", "install.json")
  let raw: string
  try {
    raw = await readFile(manifestPath, "utf8")
  } catch {
    return // no manifest to refresh — likely a first install via shell script hasn't happened yet
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return // malformed — don't touch it
  }
  if (typeof parsed !== "object" || parsed === null) return
  const record = parsed as Record<string, unknown>
  record.version = version
  record.installedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  if (asset !== undefined && "asset" in record) record.asset = asset
  if ("binPath" in record) record.binPath = destination
  // Atomic write: temp file → rename (matching the shell installer pattern).
  const tmp = `${manifestPath}.${randomUUID()}`
  try {
    await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(tmp, manifestPath)
  } catch {
    /* best-effort */
  }
}

/** Preserve signed release bytes; a fetch-written file has no browser quarantine attribute. */
export async function installReleaseBinary(
  options: BinaryInstallRequest & {
    readonly fetchAsset?: FetchAsset
    readonly run?: Run
  },
): Promise<void> {
  const { asset, version, platform } = options
  const destination = await realpath(options.destination)
  const deadline = AbortSignal.timeout(BINARY_UPDATE_TIMEOUT_MS)
  const fetch = options.fetchAsset ?? ((url: string) => fetchAsset(url, deadline))
  const probe = options.run ?? run
  try {
    await access(dirname(destination), constants.W_OK)
  } catch (cause) {
    throw new BinaryUpdateError("directory_not_writable", "the install directory is not writable", { cause })
  }
  const lockPath = `${destination}.update-lock`
  let lock
  try {
    lock = await acquireBinaryUpdateLock(lockPath)
  } catch (cause) {
    throw new BinaryUpdateError("directory_not_writable", "the install lock could not be written", { cause })
  }
  if (lock === undefined)
    throw new BinaryUpdateError("update_in_progress", `another binary update holds ${JSON.stringify(lockPath)}`)
  await sweepStaleArtifacts(destination, platform)
  const next = `${destination}.new-${randomUUID()}`
  const previous = `${destination}.old-${randomUUID()}`
  let backedUp = false
  let swapped = false
  let preserveBackup = false
  try {
    const sums = await (await download(version, "SHA256SUMS", fetch)).text()
    const matches = [...sums.matchAll(/^([a-fA-F0-9]{64}) [ *](.+)\r?$/gm)].filter((match) => match[2] === asset)
    if (matches.length !== 1)
      throw new BinaryUpdateError("integrity_failed", `SHA256SUMS must contain one checksum for ${asset}`)
    const response = await download(version, asset, fetch)
    const file = await open(next, "wx", 0o600)
    const hash = createHash("sha256")
    try {
      if (response.body === null) throw new BinaryUpdateError("integrity_failed", "the release download is empty")
      for await (const bytes of response.body) {
        hash.update(bytes)
        await file.writeFile(bytes)
      }
      await file.sync()
    } finally {
      await file.close()
    }
    if (hash.digest("hex") !== matches[0][1].toLowerCase())
      throw new BinaryUpdateError("integrity_failed", `checksum mismatch for ${asset}`)
    await chmod(next, 0o755)
    if (platform === "darwin") {
      try {
        const signature = await probe("/usr/bin/codesign", ["--verify", "--strict", next])
        if (signature.code !== 0) throw new Error("codesign verification failed")
      } catch (cause) {
        throw new BinaryUpdateError("verification_failed", "the macOS release signature could not be verified", {
          cause,
        })
      }
    }
    const installed = await lock.run(async () => {
      try {
        // POSIX keeps the old inode linked until verification, with no gap at the installed pathname.
        if (platform === "win32") await retryRename(destination, previous, basename(destination), platform)
        else await link(destination, previous)
        backedUp = true
        await retryRename(next, destination, basename(destination), platform)
        swapped = true
        try {
          const result = await probe(destination, ["--version"])
          const reported = /^omo ([^\s]+)(?:\s|$)/.exec(result.stdout.trim())?.[1]
          if (result.code !== 0 || reported === undefined || releaseVersionOf(reported) !== version) {
            throw new Error(`the installed executable did not report omo ${version}`)
          }
        } catch (cause) {
          throw new BinaryUpdateError("verification_failed", `the installed executable did not report omo ${version}`, {
            cause,
          })
        }
      } catch (cause) {
        if (backedUp && (swapped || platform === "win32")) {
          try {
            if (platform === "win32" && swapped) await rename(destination, next)
            await rename(previous, destination)
            backedUp = false
          } catch (rollbackCause) {
            preserveBackup = true
            throw new BinaryUpdateError("rollback_failed", `restore the previous executable from ${previous}`, {
              cause: rollbackCause,
            })
          }
        }
        throw cause
      }
    })
    if (!installed)
      throw new BinaryUpdateError(
        "update_in_progress",
        `the update lease expired or changed at ${JSON.stringify(lockPath)}`,
      )
  } catch (cause) {
    if (cause instanceof BinaryUpdateError) throw cause
    throw new BinaryUpdateError("install_failed", cause instanceof Error ? cause.message : String(cause), { cause })
  } finally {
    try {
      try {
        await rm(next, { force: true })
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code ?? ""
        if (code !== "ENOENT" && !(platform === "win32" && /^(EPERM|EBUSY|EACCES|EFAULT)$/.test(code))) throw cause
      }
      if (backedUp && !preserveBackup) {
        try {
          await rm(previous, { force: true })
        } catch (cause) {
          // Windows can rename a loaded image but cannot delete it until its processes exit.
          // EFAULT (bad address) can surface when a dangling kernel handle or AV-held
          // reference outlives the rename, especially on Windows 11.
          if (
            platform !== "win32" ||
            !/^(EPERM|EBUSY|EACCES|EFAULT)$/.test((cause as NodeJS.ErrnoException).code ?? "")
          )
            throw cause
        }
      }
    } finally {
      await lock.release()
    }
  }
}
