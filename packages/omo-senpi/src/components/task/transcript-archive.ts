import { join, resolve } from "node:path"

import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"

// Fixed sentinel project directory inside the Senpi agent dir's sessions tree. The existing Senpi
// session finder (and the native session picker) scans any `--<name>--` project directory for
// session JSONL files, so archives placed here are discoverable without any new tooling and
// without any OpenCode/SQLite access. cwd identity always comes from the JSONL header, never the
// directory name.
export const TASK_TRANSCRIPT_ARCHIVE_DIR_NAME = "--omo-senpi-task-archive--"

// The agent dir the RUNNING engine is attached to. The senpi runtime itself honors
// SENPI_CODING_AGENT_DIR, and the QA sandbox drivers override only that variable - so it must win
// over the installer-oriented OMO_ prefix, or a stale caller env would route archives into a
// different (real) agent dir. In a real omo install the launcher pins both to the same directory,
// so this only ever diverges in sandboxed QA.
export function resolveRuntimeAgentHome(env: Readonly<Record<string, string | undefined>>): string {
  const runtimeOverride = env["SENPI_CODING_AGENT_DIR"]?.trim()
  if (runtimeOverride !== undefined && runtimeOverride.length > 0) return resolve(runtimeOverride)
  return resolveAgentHome({ env })
}

// Resolve the archive root for an engine configured with task.transcript_retention. Undefined
// whenever retention is disabled: the engine never receives an archive dir and nothing is ever
// written.
export function resolveTranscriptArchiveDir(settings: OmoTaskSettings, env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (settings.transcript_retention?.enabled !== true) return undefined
  return join(resolveRuntimeAgentHome(env), "sessions", TASK_TRANSCRIPT_ARCHIVE_DIR_NAME)
}
