import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { TaskManager } from "../../../manager"
import { createTaskRecord } from "../../../state"
import type { TaskRecord } from "../../../state"
import type { SkillResolution, TaskToolContext, TaskToolDeps } from "../types"

export const OMO_CONFIG: OmoConfig = { categories: {}, agents: {} }

export const CTX: TaskToolContext = {
  cwd: "/work/project",
  sessionManager: { getSessionId: () => "parent-session-1" },
}

function notImplemented(name: string): never {
  throw new Error(`fake TaskManager.${name} not configured for this test`)
}

export function createFakeManager(overrides: Partial<TaskManager>): TaskManager {
  return {
    start: () => notImplemented("start"),
    continueTask: () => notImplemented("continueTask"),
    sendToTask: () => notImplemented("sendToTask"),
    interruptTask: () => notImplemented("interruptTask"),
    cancelTask: () => notImplemented("cancelTask"),
    get: () => undefined,
    list: () => [],
    waitFor: () => notImplemented("waitFor"),
    forget: () => {},
    getResidentHandle: () => undefined,
    subscribeChild: () => () => {},
    residentTaskIds: () => [],
    wasBackground: () => false,
    ...overrides,
  }
}

export function makeRecord(overrides: Partial<TaskRecord>): TaskRecord {
  const base = createTaskRecord({
    parent_session_id: "parent-session-1",
    root_session_id: "parent-session-1",
    depth: 1,
    execution_mode: "in-process",
    model: "anthropic/claude",
  })
  return { ...base, ...overrides }
}

export function makeDeps(manager: TaskManager, extra: Partial<TaskToolDeps> = {}): TaskToolDeps {
  return {
    manager,
    omoConfig: OMO_CONFIG,
    agents: {},
    resolveAncestry: (sessionId) => ({ depth: 0, rootSessionId: sessionId, lineage: "known", callerRole: "coordinator" }),
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }) satisfies SkillResolution,
    ...extra,
  }
}
