import { readdirSync, rmSync } from "node:fs"
import { chmod, copyFile, constants, mkdtemp, rm, stat } from "node:fs/promises"
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
    rmSync(join(root, entry), { recursive: true, force: true })
    removed.push(entry)
  }
  return removed
}

let processDir: Promise<string> | undefined

// One private directory per process (mode 0700 by mkdtemp), named after its owner pid and removed when it exits.
function processPinDir(): Promise<string> {
  processDir ??= Promise.resolve().then(async () => {
    sweepDeadPinDirs()
    const dir = await mkdtemp(join(tmpdir(), `${DIR_PREFIX}${process.pid}-`))
    process.once("exit", () => rmSync(dir, { recursive: true, force: true }))
    return dir
  })
  return processDir
}

export type PinResult = { readonly kind: "pinned"; readonly path: string } | { readonly kind: "invalid" } | { readonly kind: "unavailable"; readonly reason: string }

const pinned = new Map<string, Promise<PinResult>>()

async function sourceIdentity(source: string): Promise<string> {
  const info = await stat(source)
  return `${source}\0${info.dev}\0${info.ino}\0${info.size}\0${info.mtimeMs}\0${info.ctimeMs}`
}

async function copyAndVerify(source: string, verify: (path: string) => Promise<SignatureVerdict>, dir: string): Promise<PinResult> {
  const target = join(dir, `${crypto.randomUUID()}-${basename(source)}`)
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL)
    await chmod(target, 0o500)
  } catch (error) {
    await rm(target, { force: true })
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) }
  }
  if ((await verify(target)) === "valid") return { kind: "pinned", path: target }
  await rm(target, { force: true })
  return { kind: "invalid" }
}

/**
 * Copies a located helper into a directory only this process uses, makes the copy read-only, and verifies the COPY.
 * The process then spawns only that copy, so a file written to the original path later (a dev build, a broken
 * install) is never executed. The signature is inside the Mach-O, so the copy has the same designated requirement and
 * the same keychain access as the original (#11262 design 1: every copy at any path matches one ACL entry).
 * One copy is kept per source file identity; a source that changes gets a fresh copy.
 */
export async function pinVerifiedCopy(
  source: string,
  verify: (path: string) => Promise<SignatureVerdict>,
  dir?: string,
): Promise<PinResult> {
  let identity: string
  try {
    identity = `${dir ?? ""}\0${await sourceIdentity(source)}`
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) }
  }
  const known = pinned.get(identity)
  if (known !== undefined) {
    const result = await known
    if (result.kind !== "pinned" || (await verify(result.path)) === "valid") return result
  }
  const created = Promise.resolve(dir ?? processPinDir()).then(target => copyAndVerify(source, verify, target))
  pinned.set(identity, created)
  const result = await created
  if (result.kind === "unavailable") pinned.delete(identity)
  return result
}
