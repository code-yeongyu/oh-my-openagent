import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import { withTaskRecordLockAsync } from "../store/record-lock"
import { atomicReplace } from "../store/record-write"
import { formatTaskNickname } from "./nickname-format"

type Allocation = {
  readonly set: string
  readonly pool: readonly string[]
  readonly parentSessionId: string
  readonly conversationId: string
  readonly style: NonNullable<OmoTaskSettings["nicknames"]>["occurrence_style"]
}

type RotationState = {
  readonly version: 1
  readonly cursors: Record<string, number>
  readonly occurrences: Record<string, number>
}

function fingerprint(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

export function createNicknameAllocator(agentHome: string) {
  const path = join(agentHome, "task-nicknames.json")
  return (input: Allocation): Promise<string | undefined> => {
    const pool = [...new Set(input.pool)]
    if (pool.length === 0) return Promise.resolve(undefined)
    const poolKey = fingerprint([input.set, pool])
    return withTaskRecordLockAsync(path, async () => {
      const state = readState(path)
      const cursor =
        state.cursors[poolKey] ?? Number.parseInt(fingerprint([input.parentSessionId, input.set]).slice(0, 8), 16) % pool.length
      const base = pool[cursor]
      if (base === undefined) throw new Error("Invalid nickname pool cursor")
      const occurrenceKey = fingerprint([input.conversationId, base])
      const occurrence = (state.occurrences[occurrenceKey] ?? 0) + 1
      if (!Number.isSafeInteger(occurrence)) throw new Error("Nickname count exhausted")
      const label = formatTaskNickname(base, occurrence, input.style ?? "roman")
      state.cursors[poolKey] = (cursor + 1) % pool.length
      state.occurrences[occurrenceKey] = occurrence
      // Commit both positions together before revealing the label. A crash can skip a reservation.
      atomicReplace(path, JSON.stringify(state))
      return label
    })
  }
}

function readState(path: string): RotationState {
  let content: string
  try {
    content = readFileSync(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, cursors: {}, occurrences: {} }
    }
    throw error
  }
  const value: unknown = JSON.parse(content)
  if (!isObject(value) || value.version !== 1 || !isIndex(value.cursors, 0) || !isIndex(value.occurrences, 1)) {
    throw new Error("Invalid task nickname state")
  }
  return { version: 1, cursors: value.cursors, occurrences: value.occurrences }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isIndex(value: unknown, minimum: number): value is Record<string, number> {
  return isObject(value) && Object.entries(value).every(([key, count]) =>
    /^[0-9a-f]{64}$/.test(key) && typeof count === "number" && Number.isSafeInteger(count) && count >= minimum,
  )
}
