import { join } from "node:path"

const SISYPHUS_DIR = ".sisyphus"
const AGENT_TEAMS_DIR = "agent-teams"

export function getAgentTeamsRootDir(): string {
  return join(process.cwd(), SISYPHUS_DIR, AGENT_TEAMS_DIR)
}

export function getTeamsRootDir(): string {
  return join(getAgentTeamsRootDir(), "teams")
}

export function getTeamTasksRootDir(): string {
  return join(getAgentTeamsRootDir(), "tasks")
}

export function getTeamDir(teamName: string): string {
  return join(getTeamsRootDir(), teamName)
}

export function getTeamConfigPath(teamName: string): string {
  return join(getTeamDir(teamName), "config.json")
}

export function getTeamInboxDir(teamName: string): string {
  return join(getTeamDir(teamName), "inboxes")
}

export function getTeamInboxPath(teamName: string, agentName: string): string {
  return join(getTeamInboxDir(teamName), `${agentName}.json`)
}

export function getTeamTaskDir(teamName: string): string {
  return join(getTeamTasksRootDir(), teamName)
}

export function getTeamTaskPath(teamName: string, taskId: string): string {
  return join(getTeamTaskDir(teamName), `${taskId}.json`)
}
