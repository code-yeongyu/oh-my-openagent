import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import type { TaskManager } from "../../manager"
import type { TaskToolParamsStatic } from "./params"

// The narrow slice of senpi's ExtensionContext the task tool reads. ExtensionContext satisfies it
// structurally, so the tool stays testable with a tiny fake while the ToolDefinition keeps the full
// senpi context type at its execute() boundary.
export type TaskToolContext = {
  readonly cwd: string
  readonly sessionManager: { getSessionId(): string }
}

// Parent-session ancestry the tool folds into the child spawn: the child's depth is the parent's
// depth + 1 and the root session is inherited. Absent ancestry means a top-level session (depth 0).
export type TaskAncestry = {
  readonly depth: number
  readonly rootSessionId: string
}

export type ResolveAncestry = (parentSessionId: string) => TaskAncestry | undefined

// v1 load_skills contract: resolve named skills to SKILL.md content and expose a ready-to-prepend
// block plus which names resolved vs went missing (missing names never fail the spawn).
export type SkillResolution = {
  readonly prepend: string
  readonly resolved: readonly string[]
  readonly missing: readonly string[]
}

export type SkillLoader = (names: readonly string[], cwd: string) => SkillResolution

export type TaskCategoryInfo = {
  readonly name: string
  readonly description?: string
}

export type TaskAgentInfo = {
  readonly name: string
  readonly description?: string
}

export type TaskToolDeps = {
  readonly manager: TaskManager
  readonly omoConfig: OmoConfig
  readonly agents: Readonly<Record<string, AgentDefinition>>
  readonly resolveAncestry?: ResolveAncestry
  readonly loadSkills?: SkillLoader
}

export type TaskToolMode = "spawn"

export type TaskToolDetails = {
  readonly task_id: string
  readonly status: string
  readonly mode: TaskToolMode
  readonly name?: string
  readonly category?: string
  readonly subagent_type?: string
  readonly execution_mode?: string
  readonly model?: string
  readonly run_in_background?: boolean
  readonly queue_position?: number
  readonly reason?: string
}

export type { TaskToolParamsStatic }
