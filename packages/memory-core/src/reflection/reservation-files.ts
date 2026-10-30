import { randomUUID } from "node:crypto"
import { hostname } from "node:os"
import { dirname, join } from "node:path"

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "../fs/resilient"
import { getProcessStartIdentity } from "../locks"
import type { ReflectionRequest, ReservedRun } from "./machine"

export interface ReflectionLauncherIdentity {
  readonly pid: number
  readonly hostname: string
  readonly processStart: string | null
}

export async function readRun(path: string): Promise<ReservedRun | null> {
  const parsed = await readJsonOptional(path)
  if (parsed === null) return null
  if (!isReservedRun(parsed)) throw new Error(`Invalid reflection reservation: ${path}`)
  return parsed
}

export async function readJsonOptional(path: string): Promise<unknown | null> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
  return JSON.parse(raw) as unknown
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  let renamed = false
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporaryPath, path)
    renamed = true
  } finally {
    if (!renamed) await unlinkIfPresent(temporaryPath)
  }
}

export async function unlinkIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error
  })
}

export async function sweepReservationTemporaries(directory: string, targets: readonly string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile() || !targets.some((target) => entry.name.startsWith(`${target}.tmp-`))) continue
    await unlinkIfPresent(join(directory, entry.name))
  }
}

export async function writeOptionalRun(path: string, run: ReservedRun | undefined): Promise<void> {
  if (!run) {
    await unlinkIfPresent(path)
    return
  }
  await writeJsonAtomic(path, run)
}

export async function currentLauncherIdentity(): Promise<ReflectionLauncherIdentity> {
  return {
    pid: process.pid,
    hostname: hostname(),
    processStart: await getProcessStartIdentity(process.pid),
  }
}

function isReservedRun(value: unknown): value is ReservedRun {
  if (!value || typeof value !== "object") return false
  const run = value as Record<string, unknown>
  return typeof run.runId === "string" && run.runId.length > 0 && isReflectionRequest(run.request)
}

function isReflectionRequest(value: unknown): value is ReflectionRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Record<string, unknown>
  return (
    (request.trigger === "manual" || request.trigger === "compaction" || request.trigger === "step-count" || request.trigger === "dream") &&
    (request.trigger === "dream"
      ? request.origin === "manual" || request.origin === "idle" || request.origin === "shutdown" || request.origin === "pressure"
      : request.origin === undefined) &&
    Array.isArray(request.conversationIds) && request.conversationIds.every((id) => typeof id === "string") &&
    Array.isArray(request.snapshots) &&
    (request.targetDoc === undefined || (request.trigger === "dream" && typeof request.targetDoc === "string"))
  )
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
