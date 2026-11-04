import { randomUUID } from "node:crypto"
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync,
  rmSync, unlinkSync, writeSync, type Stats,
} from "node:fs"
import { join } from "node:path"

const CONTROL_FILE_MAX_BYTES = 16 * 1024

export type ControlFsEnv = {
  readonly platform: NodeJS.Platform
  readonly uid: number | undefined
  // Test seam: a stat reader standing in for a foreign owner or a hard link.
  readonly lstat?: (path: string) => Stats
}

export function defaultControlFsEnv(): ControlFsEnv {
  return { platform: process.platform, uid: process.getuid?.() }
}

export type ControlFileRefusal = "control_dir_unsafe" | "file_unsafe" | "file_oversized"

export type ControlRead =
  | { readonly kind: "absent" }
  | { readonly kind: "refused"; readonly reason: ControlFileRefusal }
  | { readonly kind: "ok"; readonly text: string; readonly mtimeMs: number }

const WINDOWS_RENAME_RETRIES = 8
const WINDOWS_TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"])
const sleeper = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

const code = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined

function statOf(env: ControlFsEnv, path: string): Stats {
  return (env.lstat ?? lstatSync)(path)
}

// The rule both writers and readers apply before touching the directory (design 3.1): a real
// directory, never a symlink, owned by this user and not group- or world-writable.
export function ensureControlDir(dir: string, env: ControlFsEnv, create: boolean): boolean {
  if (create) {
    try { mkdirSync(dir, { mode: 0o700 }) } catch (error) { if (code(error) !== "EEXIST") return false }
  }
  let stat: Stats
  try { stat = statOf(env, dir) } catch { return false }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  if (env.platform === "win32") return true
  return stat.uid === env.uid && (stat.mode & 0o022) === 0
}

function renameWithRetry(from: string, to: string, platform: NodeJS.Platform): void {
  for (let attempt = 0; ; attempt += 1) {
    try { renameSync(from, to); return } catch (error) {
      if (platform !== "win32" || attempt >= WINDOWS_RENAME_RETRIES || !WINDOWS_TRANSIENT.has(code(error) ?? "")) throw error
      Atomics.wait(sleeper, 0, 0, 5)
    }
  }
}

export type ControlWrite = { readonly kind: "written" } | { readonly kind: "refused"; readonly reason: "control_dir_unsafe" | "write_failed" }

export function writeControlFile(dir: string, name: string, text: string, env: ControlFsEnv): ControlWrite {
  if (!ensureControlDir(dir, env, true)) return { kind: "refused", reason: "control_dir_unsafe" }
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`)
  const flags = env.platform === "win32" ? "wx"
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, flags, 0o600)
    writeSync(descriptor, text)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameWithRetry(temporary, join(dir, name), env.platform)
    return { kind: "written" }
  } catch {
    return { kind: "refused", reason: "write_failed" }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
}

// The file rule (design 3.3 step 1): a regular file with one link, this user's, exactly 0600,
// opened without following links and re-checked by device and inode before it is parsed.
export function readControlFile(dir: string, name: string, env: ControlFsEnv): ControlRead {
  if (!ensureControlDir(dir, env, false)) {
    try { lstatSync(dir) } catch (error) { if (code(error) === "ENOENT") return { kind: "absent" } }
    return { kind: "refused", reason: "control_dir_unsafe" }
  }
  const path = join(dir, name)
  let before: Stats
  try { before = statOf(env, path) } catch (error) {
    return code(error) === "ENOENT" ? { kind: "absent" } : { kind: "refused", reason: "file_unsafe" }
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) return { kind: "refused", reason: "file_unsafe" }
  if (env.platform !== "win32" && (before.uid !== env.uid || (before.mode & 0o7777) !== 0o600)) return { kind: "refused", reason: "file_unsafe" }
  const flags = env.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, flags)
    const opened = fstatSync(descriptor)
    if (opened.dev !== before.dev || opened.ino !== before.ino) return { kind: "refused", reason: "file_unsafe" }
    if (opened.size > CONTROL_FILE_MAX_BYTES) return { kind: "refused", reason: "file_oversized" }
    return { kind: "ok", text: readFileSync(descriptor, "utf8"), mtimeMs: opened.mtimeMs }
  } catch (error) {
    return code(error) === "ENOENT" ? { kind: "absent" } : { kind: "refused", reason: "file_unsafe" }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export function removeControlFile(dir: string, name: string): void {
  try { unlinkSync(join(dir, name)) } catch (error) { if (code(error) !== "ENOENT") throw error }
}

export function listControlFiles(dir: string, env: ControlFsEnv): readonly { readonly name: string; readonly mtimeMs: number }[] {
  if (!ensureControlDir(dir, env, false)) return []
  const entries: { name: string; mtimeMs: number }[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue
    try { entries.push({ name, mtimeMs: lstatSync(join(dir, name)).mtimeMs }) } catch { continue }
  }
  return entries.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
}
