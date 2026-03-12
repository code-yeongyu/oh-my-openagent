import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  TEAM_GOVERNANCE_FILE,
  TEAM_MAILBOX_FILE,
  TEAM_MANIFEST_FILE,
  TEAM_MODE_DIR,
  TEAM_MONITOR_FILE,
  TEAM_PHASE_FILE,
  TEAM_SUMMARY_FILE,
  TEAM_TASKS_FILE,
  TEAM_WORKERS_FILE,
} from "./constants"
import type { TeamRuntimeState } from "./types"

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

export function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

export function getTeamModeRoot(directory: string): string {
  return join(directory, TEAM_MODE_DIR)
}

export function getTeamStatePath(directory: string, teamId: string): string {
  return join(getTeamModeRoot(directory), teamId)
}

export function ensureTeamStatePath(directory: string, teamId: string): string {
  const teamStatePath = getTeamStatePath(directory, teamId)
  mkdirSync(teamStatePath, { recursive: true })
  return teamStatePath
}

export function listTeamIds(directory: string): string[] {
  const root = getTeamModeRoot(directory)
  if (!existsSync(root)) return []

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

export function readTeamRuntimeState(directory: string, teamId: string): TeamRuntimeState | null {
  const teamPath = getTeamStatePath(directory, teamId)
  if (!existsSync(teamPath)) return null

  const manifest = readJson<TeamRuntimeState["manifest"]>(join(teamPath, TEAM_MANIFEST_FILE))
  const workers = readJson<TeamRuntimeState["workers"]>(join(teamPath, TEAM_WORKERS_FILE))
  const tasks = readJson<TeamRuntimeState["tasks"]>(join(teamPath, TEAM_TASKS_FILE))
  const mailbox = readJson<TeamRuntimeState["mailbox"]>(join(teamPath, TEAM_MAILBOX_FILE))
  const governance = readJson<TeamRuntimeState["governance"]>(join(teamPath, TEAM_GOVERNANCE_FILE))
  const phase = readJson<TeamRuntimeState["phase"]>(join(teamPath, TEAM_PHASE_FILE))
  const summary = readJson<TeamRuntimeState["summary"]>(join(teamPath, TEAM_SUMMARY_FILE))
  const monitor = readJson<TeamRuntimeState["monitor"]>(join(teamPath, TEAM_MONITOR_FILE))

  if (!manifest || !workers || !tasks || !mailbox || !governance || !phase || !summary || !monitor) {
    return null
  }

  return { manifest, workers, tasks, mailbox, governance, phase, summary, monitor }
}

export function writeTeamRuntimeState(directory: string, state: TeamRuntimeState): void {
  const teamPath = ensureTeamStatePath(directory, state.manifest.team_id)
  writeJson(join(teamPath, TEAM_MANIFEST_FILE), state.manifest)
  writeJson(join(teamPath, TEAM_WORKERS_FILE), state.workers)
  writeJson(join(teamPath, TEAM_TASKS_FILE), state.tasks)
  writeJson(join(teamPath, TEAM_MAILBOX_FILE), state.mailbox)
  writeJson(join(teamPath, TEAM_GOVERNANCE_FILE), state.governance)
  writeJson(join(teamPath, TEAM_PHASE_FILE), state.phase)
  writeJson(join(teamPath, TEAM_SUMMARY_FILE), state.summary)
  writeJson(join(teamPath, TEAM_MONITOR_FILE), state.monitor)
}

export function updateTeamRuntimeState(
  directory: string,
  teamId: string,
  updater: (state: TeamRuntimeState) => TeamRuntimeState,
): TeamRuntimeState | null {
  const current = readTeamRuntimeState(directory, teamId)
  if (!current) return null

  const next = updater(current)
  writeTeamRuntimeState(directory, next)
  return next
}

export function getTeamWorkerSessionIds(directory: string, teamId: string): string[] {
  const state = readTeamRuntimeState(directory, teamId)
  if (!state) return []
  return state.workers
    .filter((worker) => worker.role === "worker" && worker.session_id)
    .map((worker) => worker.session_id!)
}
