import type { AgentDefinition } from "../types"

import { CODE_REVIEWER_AGENT } from "./code-reviewer"
import { EXPLORE_AGENT } from "./explore"
import { GATE_REVIEWER_AGENT } from "./gate-reviewer"
import { LIBRARIAN_AGENT } from "./librarian"
import { METIS_AGENT } from "./metis"
import { MOMUS_AGENT } from "./momus"
import { QA_EXECUTOR_AGENT } from "./qa-executor"

export const CURATED_READONLY_AGENT_DEFAULTS: readonly AgentDefinition[] = [
  EXPLORE_AGENT,
  LIBRARIAN_AGENT,
  METIS_AGENT,
  MOMUS_AGENT,
] as const

// The ulw-loop reviewer trio writes report artifacts, so it stays out of the curated read-only
// set (which pins the restricted read-only bash broker) while still shipping as builtins.
export const ULW_REVIEWER_AGENT_DEFAULTS: readonly AgentDefinition[] = [
  CODE_REVIEWER_AGENT,
  QA_EXECUTOR_AGENT,
  GATE_REVIEWER_AGENT,
] as const

export const BUILTIN_AGENT_DEFAULTS: readonly AgentDefinition[] = [
  ...CURATED_READONLY_AGENT_DEFAULTS,
  ...ULW_REVIEWER_AGENT_DEFAULTS,
] as const

export const BUILTIN_AGENTS: Readonly<Record<string, AgentDefinition>> = Object.fromEntries(
  BUILTIN_AGENT_DEFAULTS.map((definition) => [definition.name, definition]),
)

export const CURATED_READONLY_AGENT_NAMES: ReadonlySet<string> = new Set(
  CURATED_READONLY_AGENT_DEFAULTS.map((definition) => definition.name),
)

export const ULW_REVIEWER_AGENT_NAMES: ReadonlySet<string> = new Set(
  ULW_REVIEWER_AGENT_DEFAULTS.map((definition) => definition.name),
)
