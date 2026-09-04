import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"

export type EmbeddedFile = Blob & {
  name: string
  arrayBuffer?: () => Promise<ArrayBuffer>
  bytes?: () => Promise<Uint8Array>
  text?: () => Promise<string>
}
export type EmbeddedManifestEntry = { relPath: string; sha256: string; mode: number; size: number }
export type EmbeddedManifest = { omoAiVersion: string; enginePin: string; manifestSha: string; entries: EmbeddedManifestEntry[] }

export function isProvisionedExecutable(execPath: string, expectedPath: string): boolean {
  try {
    return realpathSync(execPath) === realpathSync(expectedPath)
  } catch {
    return resolve(execPath) === resolve(expectedPath)
  }
}

/**
 * True when the destination already holds this exact executable. The binary is ~114MB, so
 * re-copying it on every launch costs real wall-clock time for no benefit; size equality is
 * sufficient here because the destination is only ever written from this same source.
 */
function provisionedExecutableMatches(sourcePath: string, destinationPath: string): boolean {
  try {
    return statSync(destinationPath).size === statSync(sourcePath).size
  } catch {
    return false
  }
}

export function materializeProvisionedExecutable(
  sourcePath: string,
  destinationPath: string,
  platform = process.platform,
): void {
  if (platform === "win32") {
    if (existsSync(destinationPath)) return
    copyFileSync(sourcePath, destinationPath)
    chmodSync(destinationPath, 0o755)
    return
  }
  if (provisionedExecutableMatches(sourcePath, destinationPath)) return
  if (existsSync(destinationPath)) {
    try {
      statSync(sourcePath)
    } catch {
      return
    }
  }
  const temporaryPath = `${destinationPath}.tmp-${process.pid}`
  try {
    rmSync(temporaryPath, { force: true })
    copyFileSync(sourcePath, temporaryPath)
    chmodSync(temporaryPath, 0o755)
    renameSync(temporaryPath, destinationPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function stripDeletedExecSuffix(execPath: string): string {
  return execPath.endsWith(" (deleted)") ? execPath.slice(0, -" (deleted)".length) : execPath
}

export function runningExecutablePath(
  argv0 = process.argv[0],
  execPath = process.execPath,
  platform = process.platform,
): string {
  if (platform === "linux") return stripDeletedExecSuffix(execPath)
  return platform === "win32" && argv0.toLowerCase().endsWith(".exe") ? argv0 : execPath
}

export function shouldReexecAfterProvisioning(platform = process.platform): boolean {
  return platform !== "win32"
}

export async function embeddedText(file: EmbeddedFile): Promise<string> {
  if (file.text) return file.text()
  if (file.arrayBuffer) return Buffer.from(await file.arrayBuffer()).toString("utf8")
  throw new Error(`embedded asset ${file.name} cannot be read`)
}

async function embeddedBytes(file: EmbeddedFile): Promise<Uint8Array> {
  if (file.bytes) return file.bytes()
  if (file.arrayBuffer) return new Uint8Array(await file.arrayBuffer())
  throw new Error(`embedded asset ${file.name} cannot be read as bytes`)
}

export async function selectRuntimeManifest(embedded: EmbeddedFile[]): Promise<EmbeddedFile | undefined> {
  const exact = embedded.find((file) => file.name === "omo-runtime/runtime-manifest.json")
  if (exact) return exact
  for (const file of embedded) {
    if (!file.name.endsWith("runtime-manifest.json")) continue
    try {
      const parsed = JSON.parse(await embeddedText(file))
      if (typeof parsed?.omoAiVersion === "string" && typeof parsed?.enginePin === "string") return file
    } catch {
      // Non-manifest assets with a similar name are not candidates.
    }
  }
  return undefined
}

export async function provisionEmbeddedRuntime(manifest: EmbeddedManifest, embedded: EmbeddedFile[], runtimeDir: string): Promise<void> {
  mkdirSync(runtimeDir, { recursive: true })
  const marker = join(runtimeDir, ".provisioned")
  if (readFileIfExists(marker)?.trim() === manifest.manifestSha) return
  const byPath = new Map(embedded.map((file) => [
    file.name.replace(/^\.\//, "").replace(/^omo-runtime\//, ""),
    file,
  ]))
  for (const entry of manifest.entries) {
    const file = byPath.get(entry.relPath.replace(/^\.\//, ""))
    if (!file) throw new Error(`embedded asset missing: ${entry.relPath}`)
    const bytes = await embeddedBytes(file)
    if (bytes.byteLength !== entry.size || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new Error(`embedded asset integrity mismatch: ${entry.relPath}`)
    }
    const destination = join(runtimeDir, entry.relPath)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytes, { mode: entry.mode })
    chmodSync(destination, entry.mode)
  }
  writeFileSync(marker, `${manifest.manifestSha}\n`, { mode: 0o644 })
}

function readFileIfExists(path: string): string | undefined {
  try { return readFileSync(path, "utf8") } catch { return undefined }
}
