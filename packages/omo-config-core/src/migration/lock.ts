import { join } from "node:path"
import { toPosixPath } from "../internal/posix-path"
import { resolveHomeDir } from "../loader"
import type { MigrationClock, MigrationEnvironment, MigrationFileSystem, MigrationProcess } from "./types"

const DEFAULT_LEASE_DURATION_MS = 30_000
const GUARD_LEASE_DURATION_MS = 1_000

type LockRecord = {
  readonly leaseExpiresAt: number
  readonly pid: number
}

export type MigrationLock = {
  readonly release: () => void
  readonly renew: () => void
}

export function migrationLockPath(env: MigrationEnvironment): string {
  return toPosixPath(join(resolveHomeDir(env), ".omo", ".migration.lock"))
}

function mutationGuardPath(env: MigrationEnvironment): string {
  return `${migrationLockPath(env)}.guard`
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST"
}

function isFileMissingError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT"
}

function parseLockRecord(content: string): LockRecord | null {
  try {
    const value: unknown = JSON.parse(content)
    if (typeof value !== "object" || value === null) return null
    const pid = Reflect.get(value, "pid")
    const leaseExpiresAt = Reflect.get(value, "leaseExpiresAt")
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) return null
    if (typeof leaseExpiresAt !== "number" || !Number.isFinite(leaseExpiresAt)) return null
    return { leaseExpiresAt, pid }
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function leaseContent(process: MigrationProcess, clock: MigrationClock, duration: number): string {
  return `${JSON.stringify({ leaseExpiresAt: clock.now() + duration, pid: process.pid })}\n`
}

function isExpiredDead(record: LockRecord, clock: MigrationClock, process: MigrationProcess): boolean {
  return record.leaseExpiresAt <= clock.now() && !process.isAlive(record.pid)
}

function acquireMutationGuard(input: {
  readonly clock: MigrationClock
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly process: MigrationProcess
}): string | null {
  const path = mutationGuardPath(input.env)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const content = leaseContent(input.process, input.clock, GUARD_LEASE_DURATION_MS)
    try {
      input.fileSystem.writeFileExclusiveSync(path, content)
      return content
    } catch (error) {
      if (!isFileExistsError(error)) throw error
    }
    const observedContent = input.fileSystem.readFileSync(path, "utf-8")
    const observed = parseLockRecord(observedContent)
    if (observed === null || !isExpiredDead(observed, input.clock, input.process)) return null
    input.fileSystem.removeIfContentsMatchSync(path, observedContent)
  }
  return null
}

function releaseMutationGuard(input: {
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly content: string
}): void {
  input.fileSystem.removeIfContentsMatchSync(mutationGuardPath(input.env), input.content)
}

export function acquireMigrationLock(input: {
  readonly clock: MigrationClock
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly leaseDurationMs?: number
  readonly process: MigrationProcess
}): MigrationLock | null {
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS
  const path = migrationLockPath(input.env)
  input.fileSystem.mkdirSync(toPosixPath(join(resolveHomeDir(input.env), ".omo")), { recursive: true })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentContent = leaseContent(input.process, input.clock, leaseDurationMs)
    try {
      input.fileSystem.writeFileExclusiveSync(path, currentContent)
      let ownedContent = currentContent
      const mutate = (mutation: (nextContent: string) => boolean): void => {
        const guardContent = acquireMutationGuard(input)
        if (guardContent === null) throw new Error("Migration lock mutation is busy")
        try {
          const renewedContent = leaseContent(input.process, input.clock, leaseDurationMs)
          if (!mutation(renewedContent)) throw new Error("Migration lock ownership was lost")
          ownedContent = renewedContent
        } finally {
          releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent })
        }
      }
      return {
        release: (): void => {
          const guardContent = acquireMutationGuard(input)
          if (guardContent === null) return
          try {
            input.fileSystem.removeIfContentsMatchSync(path, ownedContent)
          } finally {
            releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent })
          }
        },
        renew: (): void => {
          mutate((renewedContent) => input.fileSystem.replaceIfContentsMatchSync(path, ownedContent, renewedContent))
        },
      }
    } catch (error) {
      if (!isFileExistsError(error)) throw error
    }

    const guardContent = acquireMutationGuard(input)
    if (guardContent === null) return null
    try {
      let observedContent: string
      try {
        observedContent = input.fileSystem.readFileSync(path, "utf-8")
      } catch (error) {
        if (isFileMissingError(error)) continue
        throw error
      }
      const observed = parseLockRecord(observedContent)
      if (observed === null || !isExpiredDead(observed, input.clock, input.process)) return null
      input.fileSystem.removeIfContentsMatchSync(path, observedContent)
    } finally {
      releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent })
    }
  }

  return null
}
