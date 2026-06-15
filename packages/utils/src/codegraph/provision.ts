import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir, hostname } from "node:os"
import { basename, join } from "node:path"

export interface CodegraphProvisionAsset {
  readonly executableName: string
  readonly sha256: string
  readonly url: string
}

export interface CodegraphProvisionManifest {
  readonly assets: Record<string, CodegraphProvisionAsset>
  readonly version: string
}

export interface EnsureCodegraphProvisionedOptions {
  readonly downloader?: (asset: CodegraphProvisionAsset) => Promise<Uint8Array>
  readonly forceBadChecksum?: boolean
  readonly installDir?: string
  readonly lockDir: string
  readonly lockStaleMs?: number
  readonly lockWaitMs?: number
  readonly manifest?: CodegraphProvisionManifest
  readonly platformKey?: string
  readonly version: "1.0.1"
}

export interface CodegraphProvisionResult {
  readonly binPath?: string
  readonly error?: string
  readonly provisioned: boolean
}

const DEFAULT_LOCK_WAIT_MS = 5_000
const DEFAULT_LOCK_STALE_MS = 120_000
const DEFAULT_MANIFEST: CodegraphProvisionManifest = {
  assets: {},
  version: "1.0.1",
}

function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

function markerPath(installDir: string, version: string): string {
  return join(installDir, ".provisioned", `codegraph-${version}.json`)
}

function defaultInstallDir(): string {
  return join(homedir(), ".omo", "codegraph")
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function defaultDownloader(asset: CodegraphProvisionAsset): Promise<Uint8Array> {
  const response = await fetch(asset.url)
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

function forcedBadChecksumOptions(options: EnsureCodegraphProvisionedOptions): {
  readonly downloader: (asset: CodegraphProvisionAsset) => Promise<Uint8Array>
  readonly installDir: string
  readonly manifest: CodegraphProvisionManifest
  readonly platformKey: string
} | null {
  if (options.forceBadChecksum !== true) return null
  const key = options.platformKey ?? platformKey()
  return {
    downloader: async () => new TextEncoder().encode("checksum mismatch"),
    installDir: options.installDir ?? join(options.lockDir, "codegraph-force-bad-checksum"),
    manifest: {
      assets: {
        [key]: { executableName: process.platform === "win32" ? "codegraph.exe" : "codegraph", sha256: "0000", url: "memory://bad" },
      },
      version: options.version,
    },
    platformKey: key,
  }
}

async function readMarker(path: string): Promise<string | null> {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(await readFile(path, "utf8"))
    if (typeof raw === "object" && raw !== null && "binPath" in raw) {
      const value = raw.binPath
      return typeof value === "string" && existsSync(value) ? value : null
    }
    return null
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

async function acquireLock(lockPath: string, waitMs: number, staleMs: number): Promise<(() => Promise<void>) | null> {
  const startedAt = Date.now()
  await mkdir(join(lockPath, ".."), { recursive: true })

  while (Date.now() - startedAt <= waitMs) {
    try {
      await mkdir(lockPath)
      return () => rm(lockPath, { force: true, recursive: true })
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error
      const lockStat = await stat(lockPath).catch(() => null)
      if (lockStat !== null && Date.now() - lockStat.mtimeMs > staleMs) {
        await rm(lockPath, { force: true, recursive: true })
        continue
      }
      await sleep(25)
    }
  }

  return null
}

async function installAsset(
  asset: CodegraphProvisionAsset,
  installDir: string,
  downloader: (asset: CodegraphProvisionAsset) => Promise<Uint8Array>,
  version: string,
): Promise<string> {
  const stagingDir = join(installDir, ".staging", randomUUID())
  const destination = join(installDir, "bin", asset.executableName)
  try {
    await mkdir(stagingDir, { recursive: true })
    const bytes = await downloader(asset)
    const actualChecksum = sha256(bytes)
    if (actualChecksum !== asset.sha256) {
      throw new Error(`checksum mismatch for ${basename(asset.url)}: expected ${asset.sha256}, got ${actualChecksum}`)
    }

    const staged = join(stagingDir, asset.executableName)
    await writeFile(staged, bytes)
    await chmod(staged, 0o755)
    await mkdir(join(installDir, "bin"), { recursive: true })
    await rm(destination, { force: true })
    await rename(staged, destination)
    await mkdir(join(installDir, ".provisioned"), { recursive: true })
    await writeFile(markerPath(installDir, version), `${JSON.stringify({ binPath: destination, version })}\n`)
    return destination
  } finally {
    await rm(stagingDir, { force: true, recursive: true })
  }
}

export async function ensureCodegraphProvisioned(
  options: EnsureCodegraphProvisionedOptions,
): Promise<CodegraphProvisionResult> {
  const forced = forcedBadChecksumOptions(options)
  const installDir = forced?.installDir ?? options.installDir ?? defaultInstallDir()
  const manifest = forced?.manifest ?? options.manifest ?? DEFAULT_MANIFEST
  const activePlatformKey = forced?.platformKey ?? options.platformKey ?? platformKey()
  const downloader = forced?.downloader ?? options.downloader ?? defaultDownloader
  const marker = markerPath(installDir, options.version)
  const existing = await readMarker(marker)
  if (existing !== null) return { binPath: existing, provisioned: true }

  const lockPath = join(options.lockDir, `codegraph-${hostname()}.lock`)
  const release = await acquireLock(
    lockPath,
    options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
    options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS,
  )
  if (release === null) return { error: "timed out waiting for codegraph provisioning lock", provisioned: false }

  try {
    const lockedExisting = await readMarker(marker)
    if (lockedExisting !== null) return { binPath: lockedExisting, provisioned: true }

    if (manifest.version !== options.version) {
      return { error: `manifest version ${manifest.version} does not match requested ${options.version}`, provisioned: false }
    }

    const asset = manifest.assets[activePlatformKey]
    if (asset === undefined) {
      return { error: `no CodeGraph ${options.version} asset for ${activePlatformKey}`, provisioned: false }
    }

    const binPath = await installAsset(asset, installDir, downloader, options.version)
    return { binPath, provisioned: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), provisioned: false }
  } finally {
    await release()
  }
}
