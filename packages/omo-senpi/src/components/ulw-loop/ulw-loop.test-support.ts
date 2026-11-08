import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createUlwLoopComponent } from "./index"

export interface RecordedLog {
  level: "info" | "warn" | "error"
  message: string
  details?: unknown
}

interface StatusCall {
  cwd: string
  sessionId: string
}

export function createLogger(): ComponentLogger & { entries: RecordedLog[] } {
  const entries: RecordedLog[] = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}

export const TEST_SESSION_ID = "test-session"

// The status probe is session-scoped and fails closed without a session identity, so every event context
// that expects the toolkit to be consulted must carry the host session id the real Senpi host provides.
export function sessionEventCtx(cwd: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { cwd, sessionManager: { getSessionId: () => TEST_SESSION_ID }, ...extra }
}

export function activeStatus(id = "G001"): string {
  return JSON.stringify({
    ok: true,
    plan: {
      activeGoalId: id,
      goals: [
        {
          id,
          status: "in_progress",
          title: "Ship ulw-loop",
          successCriteria: [{ id: "C001", status: "pending" }],
        },
      ],
    },
  })
}

export function changingActiveStatuses(count: number): string[] {
  return Array.from({ length: count }, (_item, index) =>
    JSON.stringify({
      ok: true,
      plan: {
        activeGoalId: "G001",
        updatedAt: `2026-07-03T00:00:0${index}.000Z`,
        goals: [
          {
            id: "G001",
            status: "in_progress",
            title: "Ship ulw-loop",
            successCriteria: [{ id: "C001", status: "pending" }],
          },
        ],
      },
    }),
  )
}

export function completeStatus(): string {
  return JSON.stringify({
    ok: true,
    plan: {
      aggregateCompletion: { status: "complete" },
      goals: [{ id: "G001", status: "complete", successCriteria: [{ id: "C001", status: "pass" }] }],
    },
  })
}

export function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {}
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key]
    const value = patch[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

export async function withEnvAsync<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  // Keep process-global mutations scoped to synchronous invocation. Holding them
  // across await points races other Bun test files that share this process.
  return withEnv(patch, run)
}

export async function registerWithRunner(outputs: string[], logger = createLogger()): Promise<{
  readonly pi: FakeExtensionAPI
  readonly logger: ComponentLogger & { entries: RecordedLog[] }
  readonly calls: StatusCall[]
}> {
  const pi = new FakeExtensionAPI()
  const calls: StatusCall[] = []
  await createUlwLoopComponent({
    readStatus: async (cwd, sessionId) => {
      calls.push({ cwd, sessionId })
      return { code: 0, stdout: outputs.shift() ?? activeStatus() }
    },
    // Fixture cwds are synthetic paths; the real `.omo/ulw-loop` lookup is covered by its own suite.
    planExists: () => true,
  }).register(pi, { logger, config: { getFlag: () => false } })
  return { pi, logger, calls }
}

export function isTransformResult(value: unknown): value is { action: "transform"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "action") === "transform" &&
    typeof Reflect.get(value, "text") === "string"
  )
}
