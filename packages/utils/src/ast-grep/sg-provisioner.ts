import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { inflateRawSync } from "node:zlib"

import { runtimeSlug, SG_PINNED_VERSION, SG_RELEASE_ASSETS, sgBinaryName } from "./sg-manifest"
import type { SgProvisionOptions } from "./types"

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const ZIP64_SENTINEL = 0xffffffff

export type SgProvisionErrorCode = "bad_checksum" | "download_failed" | "extract_failed" | "unsupported_platform" | "write_failed"

export class SgProvisionError extends Error {
  readonly code: SgProvisionErrorCode

  constructor(code: SgProvisionErrorCode, message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options)
    this.name = "SgProvisionError"
    this.code = code
  }
}

interface ZipCentralEntry {
  readonly compressedSize: number
  readonly localHeaderOffset: number
  readonly method: number
  readonly name: string
  readonly uncompressedSize: number
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function timeoutSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(DEFAULT_DOWNLOAD_TIMEOUT_MS)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

async function downloadAsset(url: string, fetchImpl: SgProvisionOptions["fetchImpl"], signal: AbortSignal): Promise<Buffer> {
  const activeFetch = fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await activeFetch(url, { signal })
  } catch (error) {
    throw new SgProvisionError("download_failed", `failed to download ast-grep ${SG_PINNED_VERSION} from ${url}: ${describeFailure(error)}`, { cause: error })
  }
  if (!response.ok) {
    throw new SgProvisionError("download_failed", `failed to download ast-grep ${SG_PINNED_VERSION} from ${url}: HTTP ${response.status}`)
  }
  try {
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw new SgProvisionError("download_failed", `failed to read ast-grep ${SG_PINNED_VERSION} download from ${url}: ${describeFailure(error)}`, { cause: error })
  }
}

function zipEntryBaseName(entryName: string): string {
  const segments = entryName.split("/")
  return segments[segments.length - 1] ?? entryName
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const lowestOffset = Math.max(0, zip.length - 22 - 65_535)
  for (let offset = zip.length - 22; offset >= lowestOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new SgProvisionError("extract_failed", "downloaded ast-grep asset is not a zip archive")
}

function listZipEntries(zip: Buffer): readonly ZipCentralEntry[] {
  const eocdOffset = findEndOfCentralDirectory(zip)
  const entryCount = zip.readUInt16LE(eocdOffset + 10)
  let cursor = zip.readUInt32LE(eocdOffset + 16)
  const entries: ZipCentralEntry[] = []
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new SgProvisionError("extract_failed", "downloaded ast-grep zip central directory is corrupt")
    }
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    entries.push({
      compressedSize: zip.readUInt32LE(cursor + 20),
      localHeaderOffset: zip.readUInt32LE(cursor + 42),
      method: zip.readUInt16LE(cursor + 10),
      name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      uncompressedSize: zip.readUInt32LE(cursor + 24),
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function decompressZipEntry(raw: Buffer, entry: ZipCentralEntry): Buffer {
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} uses unsupported compression method ${entry.method}`)
}

function readZipEntryBytes(zip: Buffer, entry: ZipCentralEntry): Buffer {
  if (entry.compressedSize === ZIP64_SENTINEL || entry.uncompressedSize === ZIP64_SENTINEL || entry.localHeaderOffset === ZIP64_SENTINEL) {
    throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} uses unsupported zip64 extensions`)
  }
  if (zip.readUInt32LE(entry.localHeaderOffset) !== LOCAL_SIGNATURE) {
    throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} has a corrupt local header`)
  }
  const nameLength = zip.readUInt16LE(entry.localHeaderOffset + 26)
  const extraLength = zip.readUInt16LE(entry.localHeaderOffset + 28)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const bytes = decompressZipEntry(zip.subarray(dataStart, dataStart + entry.compressedSize), entry)
  if (bytes.length !== entry.uncompressedSize) {
    throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} inflated to ${bytes.length} bytes, expected ${entry.uncompressedSize}`)
  }
  return bytes
}

function extractStandaloneSgBinary(zip: Buffer, platform: NodeJS.Platform): Buffer {
  const suffix = platform === "win32" ? ".exe" : ""
  const entries = listZipEntries(zip)
  const preferredNames = [`ast-grep${suffix}`, `sg${suffix}`]
  for (const preferred of preferredNames) {
    const entry = entries.find((candidate) => zipEntryBaseName(candidate.name) === preferred)
    if (entry !== undefined) return readZipEntryBytes(zip, entry)
  }
  throw new SgProvisionError("extract_failed", `ast-grep release zip has no standalone ${preferredNames.join(" or ")} binary`)
}

function assertInsideTarget(targetDir: string, filePath: string): void {
  const relativePath = relative(targetDir, filePath)
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new SgProvisionError("write_failed", `refusing to write ast-grep binary outside targetDir: ${filePath}`)
  }
}

export async function provisionSgBinary(options: SgProvisionOptions): Promise<string> {
  const platform = options.platform ?? process.platform
  const slug = runtimeSlug(platform, options.arch ?? process.arch)
  const asset = options.releaseAssets?.[slug] ?? SG_RELEASE_ASSETS[slug]
  if (asset === undefined) {
    throw new SgProvisionError("unsupported_platform", `ast-grep ${SG_PINNED_VERSION} has no asset for ${slug}`)
  }
  const targetDir = resolve(options.targetDir)
  const destination = join(targetDir, sgBinaryName(platform))
  const tempPath = join(targetDir, `.sg-${randomUUID().slice(0, 8)}.partial`)
  assertInsideTarget(targetDir, destination)
  assertInsideTarget(targetDir, tempPath)

  try {
    await mkdir(targetDir, { recursive: true })
    const archive = await downloadAsset(asset.url, options.fetchImpl, timeoutSignal(options.signal))
    const actualSha256 = sha256(archive)
    if (actualSha256 !== asset.sha256) {
      throw new SgProvisionError("bad_checksum", `checksum mismatch for ${basename(asset.url)}: expected ${asset.sha256}, got ${actualSha256}`)
    }
    await writeFile(tempPath, extractStandaloneSgBinary(archive, platform))
    await chmod(tempPath, 0o755)
    await rename(tempPath, destination)
    return destination
  } catch (error) {
    await rm(tempPath, { force: true })
    if (error instanceof SgProvisionError) throw error
    throw new SgProvisionError("write_failed", `failed to provision ast-grep ${SG_PINNED_VERSION} into ${targetDir}: ${describeFailure(error)}`, { cause: error })
  }
}
