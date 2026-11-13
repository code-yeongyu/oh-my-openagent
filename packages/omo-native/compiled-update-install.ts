import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { access, chmod, constants, link, open, realpath, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
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
        if (platform === "win32") await rename(destination, previous)
        else await link(destination, previous)
        backedUp = true
        await rename(next, destination)
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
      await rm(next, { force: true })
      if (backedUp && !preserveBackup) {
        try {
          await rm(previous, { force: true })
        } catch (cause) {
          // Windows can rename a loaded image but cannot delete it until its processes exit.
          if (
            platform !== "win32" ||
            !["EPERM", "EBUSY", "EACCES"].includes((cause as NodeJS.ErrnoException).code ?? "")
          )
            throw cause
        }
      }
    } finally {
      await lock.release()
    }
  }
}
