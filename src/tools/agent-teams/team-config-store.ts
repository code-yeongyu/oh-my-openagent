import { existsSync, rmSync } from "node:fs"
import { acquireLock, ensureDir, readJsonSafe, writeJsonAtomic } from "../../features/claude-tasks/storage"
import {
  getTeamConfigPath,
  getTeamDir,
  getTeamInboxDir,
  getTeamTaskDir,
  getTeamTasksRootDir,
  getTeamsRootDir,
} from "./paths"
import {
  TEAM_COLOR_PALETTE,
  TeamConfig,
  TeamConfigSchema,
  TeamLeadMember,
  TeamMember,
  TeamTeammateMember,
  isTeammateMember,
} from "./types"
import { validateTeamName } from "./name-validation"
import { withTeamTaskLock } from "./team-task-store"

function nowMs(): number {
  return Date.now()
}

function assertValidTeamName(teamName: string): void {
  const validationError = validateTeamName(teamName)
  if (validationError) {
    throw new Error(validationError)
  }
}

function withTeamLock<T>(teamName: string, operation: () => T): T {
  assertValidTeamName(teamName)
  const teamDir = getTeamDir(teamName)
  ensureDir(teamDir)
  const lock = acquireLock(teamDir)
  if (!lock.acquired) {
    throw new Error("team_lock_unavailable")
  }

  try {
    return operation()
  } finally {
    lock.release()
  }
}

function createLeadMember(teamName: string, cwd: string, leadModel: string): TeamLeadMember {
  return {
    agentId: `team-lead@${teamName}`,
    name: "team-lead",
    agentType: "team-lead",
    model: leadModel,
    joinedAt: nowMs(),
    cwd,
    subscriptions: [],
  }
}

export function ensureTeamStorageDirs(teamName: string): void {
  assertValidTeamName(teamName)
  ensureDir(getTeamsRootDir())
  ensureDir(getTeamTasksRootDir())
  ensureDir(getTeamDir(teamName))
  ensureDir(getTeamInboxDir(teamName))
  ensureDir(getTeamTaskDir(teamName))
}

export function teamExists(teamName: string): boolean {
  assertValidTeamName(teamName)
  return existsSync(getTeamConfigPath(teamName))
}

export function createTeamConfig(
  teamName: string,
  description: string,
  leadSessionId: string,
  cwd: string,
  leadModel: string,
): TeamConfig {
  ensureTeamStorageDirs(teamName)

  const leadAgentId = `team-lead@${teamName}`
  const config: TeamConfig = {
    name: teamName,
    description,
    createdAt: nowMs(),
    leadAgentId,
    leadSessionId,
    members: [createLeadMember(teamName, cwd, leadModel)],
  }

  return withTeamLock(teamName, () => {
    if (teamExists(teamName)) {
      throw new Error("team_already_exists")
    }
    writeJsonAtomic(getTeamConfigPath(teamName), TeamConfigSchema.parse(config))
    return config
  })
}

export function readTeamConfig(teamName: string): TeamConfig | null {
  assertValidTeamName(teamName)
  return readJsonSafe(getTeamConfigPath(teamName), TeamConfigSchema)
}

export function readTeamConfigOrThrow(teamName: string): TeamConfig {
  const config = readTeamConfig(teamName)
  if (!config) {
    throw new Error("team_not_found")
  }
  return config
}

export function writeTeamConfig(teamName: string, config: TeamConfig): TeamConfig {
  assertValidTeamName(teamName)
  return withTeamLock(teamName, () => {
    const validated = TeamConfigSchema.parse(config)
    writeJsonAtomic(getTeamConfigPath(teamName), validated)
    return validated
  })
}

export function updateTeamConfig(teamName: string, updater: (config: TeamConfig) => TeamConfig): TeamConfig {
  assertValidTeamName(teamName)
  return withTeamLock(teamName, () => {
    const current = readJsonSafe(getTeamConfigPath(teamName), TeamConfigSchema)
    if (!current) {
      throw new Error("team_not_found")
    }

    const next = TeamConfigSchema.parse(updater(current))
    writeJsonAtomic(getTeamConfigPath(teamName), next)
    return next
  })
}

export function listTeammates(config: TeamConfig): TeamTeammateMember[] {
  return config.members.filter(isTeammateMember)
}

export function getTeamMember(config: TeamConfig, name: string): TeamMember | undefined {
  return config.members.find((member) => member.name === name)
}

export function upsertTeammate(config: TeamConfig, teammate: TeamTeammateMember): TeamConfig {
  const members = config.members.filter((member) => member.name !== teammate.name)
  members.push(teammate)
  return { ...config, members }
}

export function removeTeammate(config: TeamConfig, agentName: string): TeamConfig {
  if (agentName === "team-lead") {
    throw new Error("cannot_remove_team_lead")
  }

  return {
    ...config,
    members: config.members.filter((member) => member.name !== agentName),
  }
}

export function assignNextColor(config: TeamConfig): string {
  const teammateCount = listTeammates(config).length
  return TEAM_COLOR_PALETTE[teammateCount % TEAM_COLOR_PALETTE.length]
}

export function deleteTeamData(teamName: string): void {
  assertValidTeamName(teamName)
  withTeamLock(teamName, () => {
    const config = readJsonSafe(getTeamConfigPath(teamName), TeamConfigSchema)
    if (!config) {
      throw new Error("team_not_found")
    }

    if (listTeammates(config).length > 0) {
      throw new Error("team_has_active_members")
    }

    withTeamTaskLock(teamName, () => {
      const teamDir = getTeamDir(teamName)
      const taskDir = getTeamTaskDir(teamName)

      if (existsSync(taskDir)) {
        rmSync(taskDir, { recursive: true, force: true })
      }

      if (existsSync(teamDir)) {
        rmSync(teamDir, { recursive: true, force: true })
      }
    })
  })
}
