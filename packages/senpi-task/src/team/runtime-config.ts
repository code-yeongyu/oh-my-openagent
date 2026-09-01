import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { createRuntimeState } from "@oh-my-opencode/team-core/team-state-store"

import type { TeamSpecSource } from "./registry"

// The exact team-core config + spec-source parameter shapes, derived from the createRuntimeState
// signature so we never import team-core's `/config` subpath (outside the team-layer allowlist).
export type TeamCoreConfig = Parameters<typeof createRuntimeState>[3]
export type TeamCoreSpecSource = Parameters<typeof createRuntimeState>[2]

// Fields team-core needs but senpi never drives (tmux + mailbox transport). Held at team-core's own
// defaults so createRuntimeState and the mailbox APIs stay well-formed; senpi only maps the bounds.
const TEAM_CORE_TRANSPORT_DEFAULTS = {
  enabled: true,
  tmux_visualization: false,
  max_messages_per_run: 10000,
  max_member_turns: 500,
  message_payload_max_bytes: 32768,
  recipient_unread_max_bytes: 262144,
  mailbox_poll_interval_ms: 3000,
} as const

/**
 * Projects the omo `task.team` bounds onto a team-core config, pinning `base_dir` to the senpi team
 * storage root so team-core writes runtime state under the senpi state dir instead of `~/.omo`.
 */
export function toTeamCoreConfig(task: OmoTaskSettings, baseDir: string): TeamCoreConfig {
  return {
    ...TEAM_CORE_TRANSPORT_DEFAULTS,
    base_dir: baseDir,
    max_members: task.team.max_members,
    max_parallel_members: task.team.max_parallel_members,
    max_wall_clock_minutes: task.team.max_wall_clock_minutes,
  }
}

// team-core records spec provenance as "project" | "user"; senpi's registry distinguishes project
// spec files from `omo.json` inline specs. The inline specs land in the non-project ("user") slot.
export function toTeamCoreSpecSource(source: TeamSpecSource): TeamCoreSpecSource {
  return source === "project" ? "project" : "user"
}
