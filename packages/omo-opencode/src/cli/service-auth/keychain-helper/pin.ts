import { createHash } from "node:crypto"
import { readdirSync, rmSync } from "node:fs"
import { chmod, copyFile, constants, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import type { SignatureVerdict } from "./signature"

const DIR_PREFIX = "omo-keychain-"
const OWNED_DIR = new RegExp(`^${DIR_PREFIX}(\\d+)-`)

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}

/** Removes the pin directories of processes that are gone (a crash skips the exit cleanup). A live owner's is kept. */
export function sweepDeadPinDirs(root: string = tmpdir()): readonly string[] {
  const removed: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return removed
  }
  for (const entry of entries) {
    const owner = OWNED_DIR.exec(entry)?.[1]
    if (owner === undefined || Number(owner) === process.pid || isAlive(Number(owner))) continue
    try {
      rmSync(join(root, entry), { recursive: true, force: true })
    } catch {
      continue
    }
    removed.push(entry)
  }
  return removed
}

const STABLE_DIR = "omo-keychain-stable"
const DIGEST_CHARS = 32

// The trusted-application entry macOS stores can name the helper path. A per-process random copy never matches the
// entry written by the previous process, so an unlocked keychain then refuses access. The path is the helper's bytes,
// under the user temp dir, and it is not removed on exit: the next process executes that same path.
async function sourceDigest(source: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(source))
    .digest("hex")
    .slice(0, DIGEST_CHARS)
}

async function defaultPinDir(): Promise<string> {
  sweepDeadPinDirs()
  const dir = join(tmpdir(), STABLE_DIR)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

async function fileVerdict(
  path: string,
  verify: (path: string) => Promise<SignatureVerdict>,
): Promise<SignatureVerdict | "absent"> {
  try {
    if (!(await stat(path)).isFile()) return "absent"
  } catch {
    return "absent"
  }
  return verify(path)
}

export type PinResult =
  | { readonly kind: "pinned"; readonly path: string }
  | { readonly kind: "invalid" }
  | { readonly kind: "unavailable"; readonly reason: string }

const pinned = new Map<string, Promise<PinResult>>()

async function sourceIdentity(source: string): Promise<string> {
  const info = await stat(source)
  return `${source}\0${info.dev}\0${info.ino}\0${info.size}\0${info.mtimeMs}\0${info.ctimeMs}`
}

async function copyAndVerify(
  source: string,
  verify: (path: string) => Promise<SignatureVerdict>,
  dir: string,
): Promise<PinResult> {
  let target: string
  try {
    target = join(dir, `${await sourceDigest(source)}-${basename(source)}`)
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) }
  }
  try {
    if ((await fileVerdict(target, verify)) === "valid") return { kind: "pinned", path: target }
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) }
  }
  const temporary = `${target}.${process.pid}.partial`
  const unavailable = (error: unknown): PinResult => ({
    kind: "unavailable",
    reason: error instanceof Error ? error.message : String(error),
  })
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL)
    await chmod(temporary, 0o500)
  } catch (error) {
    await rm(temporary, { force: true })
    if ((await fileVerdict(target, verify).catch(() => "absent" as const)) === "valid")
      return { kind: "pinned", path: target }
    return unavailable(error)
  }
  let verdict: SignatureVerdict
  try {
    verdict = await verify(temporary)
  } catch (error) {
    await rm(temporary, { force: true })
    return unavailable(error)
  }
  if (verdict !== "valid") {
    await rm(temporary, { force: true })
    return { kind: "invalid" }
  }
  try {
    await rm(target, { force: true })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    if ((await fileVerdict(target, verify).catch(() => "absent" as const)) === "valid")
      return { kind: "pinned", path: target }
    return unavailable(error)
  }
  return { kind: "pinned", path: target }
}

/**
 * Copies a located helper to a path determined by its bytes, makes the copy read-only, and verifies the COPY.
 * The process then spawns only that copy, so a file written to the original path later (a dev build, a broken
 * install) is never executed. The same bytes keep the same path, including across processes, because a macOS
 * trusted-application entry can name that path: a fresh random name on every launch never matches it.
 * One copy is kept per source file identity; a source that changes gets a fresh copy.
 */
export async function pinVerifiedCopy(
  source: string,
  verify: (path: string) => Promise<SignatureVerdict>,
  dir?: string,
): Promise<PinResult> {
  let identity: string
  let resolved: string
  try {
    resolved = dir ?? (await defaultPinDir())
    identity = `${resolved}\0${await sourceIdentity(source)}`
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) }
  }
  const known = pinned.get(identity)
  if (known !== undefined) {
    const result = await known
    if (result.kind !== "pinned") return result
    let verdict: SignatureVerdict
    try {
      verdict = await verify(result.path)
    } catch (error) {
      pinned.delete(identity)
      await rm(result.path, { force: true })
      return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) }
    }
    if (verdict === "valid") return result
  }
  const created = Promise.resolve(resolved).then(
    (target) => copyAndVerify(source, verify, target),
    (error: unknown): PinResult => ({
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    }),
  )
  pinned.set(identity, created)
  const result = await created
  if (result.kind !== "pinned") pinned.delete(identity)
  return result
}
