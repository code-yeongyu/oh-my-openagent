import { createHash, randomUUID, X509Certificate } from "node:crypto"
import { constants, unlinkSync } from "node:fs"
import * as fs from "node:fs/promises"
import { homedir, tmpdir, uptime } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import type { EngineTrustMarker } from "@code-yeongyu/senpi/engine-trust"
import type { TrustDiagnosticEntry } from "./trust-diagnostics"
import { pidAnswersSignalZero, sweepTrustRetention } from "./trust-retention"

const MAX_BYTES = 8 * 1024 * 1024
const GENERATION_PREFIX = "# omo-engine-trust-generation"
const GENERATION_HEADER = /^# omo-engine-trust-generation v1 user=([0-9a-f]{64}|none)\n/
const USER_HEADER = "# omo-engine-trust-user v1\n"
const leases = new Set<string>()
const bootAtMs = Date.now() - uptime() * 1000

export class TrustStorageError extends Error {
  constructor(readonly code: "trust-user-extras-unrecoverable" | "trust-path-unrepresentable") {
    super(code)
  }
}

export function trustDirectory(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "omo", "engine-trust")
    : join(homedir(), ".omo", "engine-trust")
}

const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

export function certificateSet(pems: readonly string[]): string[] {
  return [...new Set(pems.map((pem) => digest(new X509Certificate(pem).raw)))].sort()
}

function serializeCertificates(pems: readonly string[]): string {
  const sorted = new Map<string, string>()
  for (const pem of pems) {
    const cert = new X509Certificate(pem)
    sorted.set(digest(cert.raw), cert.toString().trimEnd() + "\n")
  }
  return [...sorted].sort(([a], [b]) => a.localeCompare(b)).map(([, pem]) => pem).join("")
}

/** Malformed blocks stay an adoption loaded-set failure, never a partial import. */
function generationCertificates(text: string): { certificates: string[]; malformed: boolean } {
  const certificates: string[] = []
  let malformed = false
  for (const [block] of text.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)) {
    try { certificates.push(new X509Certificate(block).toString()) } catch { malformed = true }
  }
  return { certificates, malformed }
}

function owned(stat: { uid: number; mode: number }, mode: number): boolean {
  return process.platform === "win32" || (stat.uid === process.getuid?.() && (stat.mode & 0o777) === mode)
}

/** Ancestors may be system-owned (/home, /tmp); none may redirect through a link. */
async function ancestors(path: string): Promise<void> {
  let current = resolve(path)
  for (;;) {
    const stat = await fs.lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe trust directory")
    if (process.platform !== "win32") {
      const sticky = (stat.mode & 0o1000) !== 0
      if ((stat.uid !== 0 && stat.uid !== process.getuid?.()) || ((stat.mode & 0o022) !== 0 && !sticky)) {
        throw new Error("unsafe trust ancestor")
      }
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function privateDirectory(path: string): Promise<void> {
  await ancestors(path)
  if (!owned(await fs.lstat(path), 0o700)) throw new Error("trust directory is not private")
}

async function createPrivateDirectory(path: string): Promise<void> {
  const parent = dirname(path)
  if (parent !== path) {
    try { await ancestors(parent) } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      await createPrivateDirectory(parent)
    }
  }
  await fs.mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error
  })
  await privateDirectory(path)
}

export async function temporaryTrustDirectory(platform: NodeJS.Platform): Promise<string> {
  const directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "omo-engine-trust-"))
  await fs.chmod(directory, 0o700)
  await privateDirectory(directory)
  if (directory.includes(platform === "win32" ? ";" : ":")) throw new TrustStorageError("trust-path-unrepresentable")
  return directory
}

export async function prepareTrustDirectory(requested: string, platform: NodeJS.Platform) {
  const codes: TrustDiagnosticEntry[] = []
  let directory = requested
  try {
    if (requested.includes(platform === "win32" ? ";" : ":")) throw new Error("unrepresentable trust path")
    await createPrivateDirectory(requested)
  } catch {
    directory = await temporaryTrustDirectory(platform)
    codes.push({ code: "trust-dir-unsafe" })
  }
  if (directory.includes(platform === "win32" ? ";" : ":")) throw new TrustStorageError("trust-path-unrepresentable")
  return { directory, codes }
}

async function readOwnedTrustFile(path: string): Promise<string> {
  await ancestors(dirname(path))
  const before = await fs.lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("trust file is not regular")
  const file = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = await file.stat()
    if (!stat.isFile() || !owned(stat, 0o600) || stat.size > MAX_BYTES
      || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error("unsafe trust file")
    const bytes = Buffer.alloc(stat.size + 1)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== stat.size) throw new Error("trust file changed")
    return bytes.subarray(0, bytesRead).toString("utf8")
  } finally {
    await file.close()
  }
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}`)
  const file = await fs.open(temporary, "wx", 0o600)
  try {
    await file.writeFile(text)
    await file.sync()
  } finally {
    await file.close()
  }
  try { await fs.rename(temporary, path) } finally { await fs.unlink(temporary).catch(() => {}) }
}

async function immutableFile(directory: string, prefix: string, text: string): Promise<{ file: string; sha256: string }> {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("trust generation exceeds 8 MiB")
  const sha256 = digest(text)
  const file = join(directory, `${prefix}${sha256}.pem`)
  try {
    if (await readOwnedTrustFile(file) === text) return { file, sha256 }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  await atomicWrite(file, text)
  return { file, sha256 }
}

export async function recoverUserExtras(incoming: string | undefined, loaded: () => readonly string[], knownGeneration = false) {
  if (incoming === undefined) return { certificates: [...loaded()], recognized: false }
  let prefix: string
  try {
    const file = await fs.open(incoming, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
    try {
      if (!(await file.stat()).isFile()) throw new Error("extra file is not regular")
      const bytes = Buffer.alloc(256)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      prefix = bytes.subarray(0, bytesRead).toString("utf8")
    } finally { await file.close() }
  } catch {
    // A removed addressed generation must never turn its cached automatic roots into U.
    const certificates = [...loaded()]
    if (knownGeneration || certificates.length !== 0) throw new TrustStorageError("trust-user-extras-unrecoverable")
    return { certificates, recognized: false }
  }
  if (!prefix.startsWith(GENERATION_PREFIX)) {
    if (knownGeneration) throw new TrustStorageError("trust-user-extras-unrecoverable")
    return { certificates: [...loaded()], recognized: false }
  }
  const user = GENERATION_HEADER.exec(prefix)?.[1]
  if (user === "none") return { certificates: [], recognized: true }
  if (user === undefined) throw new TrustStorageError("trust-user-extras-unrecoverable")
  try {
    const text = await readOwnedTrustFile(join(dirname(incoming), `u-${user}.pem`))
    if (!text.startsWith(USER_HEADER) || digest(text) !== user) throw new Error("wrong user file")
    const parsed = generationCertificates(text)
    if (parsed.malformed || serializeCertificates(parsed.certificates) !== text.slice(USER_HEADER.length)) throw new Error("invalid user file")
    return { certificates: parsed.certificates, recognized: true }
  } catch {
    throw new TrustStorageError("trust-user-extras-unrecoverable")
  }
}

export async function writeTrustGeneration(directory: string, automatic: readonly string[], extras: readonly string[], user: readonly string[]) {
  const userFile = user.length === 0 ? null : await immutableFile(directory, "u-", USER_HEADER + serializeCertificates(user))
  const header = `${GENERATION_PREFIX} v1 user=${userFile?.sha256 ?? "none"}\n`
  return { ...await immutableFile(directory, "", header + serializeCertificates([...automatic, ...extras, ...user])), user: userFile?.sha256 ?? null }
}

export async function verifyTrustGeneration(marker: EngineTrustMarker) {
  const text = await readOwnedTrustFile(marker.file)
  const user = GENERATION_HEADER.exec(text)?.[1]
  if (basename(marker.file) !== `${marker.sha256}.pem` || digest(text) !== marker.sha256
    || user !== (marker.user ?? "none")) throw new Error("generation mismatch")
  return generationCertificates(text)
}

export async function verifyTrustDefaults(defaults: NonNullable<EngineTrustMarker["defaults"]>, platform: NodeJS.Platform): Promise<void> {
  if ([defaults.file, defaults.dir].some((path) => path.includes(platform === "win32" ? ";" : ":"))) throw new Error("split closure path")
  if (await readOwnedTrustFile(defaults.file) !== "") throw new Error("nonempty closure file")
  await privateDirectory(defaults.dir)
  if ((await fs.readdir(defaults.dir)).length !== 0) throw new Error("nonempty closure directory")
}

export async function createTrustDefaults(directory: string) {
  // A damaged closure is never modified in place: existing engines may still name it.
  const parent = join(directory, "defaults")
  await createPrivateDirectory(parent)
  const defaults = { file: join(parent, "empty.pem"), dir: join(parent, "empty.d") }
  await createPrivateDirectory(defaults.dir)
  try { await fs.writeFile(defaults.file, "", { flag: "wx", mode: 0o600 }) } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
  }
  await verifyTrustDefaults(defaults, process.platform)
  return defaults
}

export async function leaseTrustGeneration(marker: EngineTrustMarker): Promise<TrustDiagnosticEntry[]> {
  const directory = dirname(marker.file)
  try {
    await createPrivateDirectory(join(directory, "leases"))
    const path = join(directory, "leases", `${marker.sha256}.${process.pid}`)
    await atomicWrite(path, JSON.stringify({ v: 1, pid: process.pid, bootAtMs }))
    if (leases.size === 0) process.once("exit", () => {
      for (const lease of leases) { try { unlinkSync(lease) } catch {} }
    })
    leases.add(path)
    const now = new Date()
    await fs.utimes(marker.file, now, now)
    return []
  } catch {
    return [{ code: "trust-lease-failed" }]
  }
}

export async function retainTrustGeneration(marker: EngineTrustMarker): Promise<void> {
  await sweepTrustRetention({ directory: dirname(marker.file), current: marker.sha256, bootAtMs, isPidAlive: pidAnswersSignalZero })
}
