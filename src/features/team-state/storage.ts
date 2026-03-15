import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import {
  DEFAULT_TEAM_STATE_ROOT,
  TEAM_APPROVALS_DIRECTORY,
  TEAM_CONFIG_FILE,
  TEAM_DIRECTORY_NAME,
  TEAM_DISPATCH_DIRECTORY,
  TEAM_DISPATCH_REQUESTS_FILE,
  TEAM_MAILBOX_DIRECTORY,
  TEAM_MANIFEST_FILE,
  TEAM_MONITOR_SNAPSHOT_FILE,
  TEAM_SHUTDOWN_ACKS_DIRECTORY,
  TEAM_SHUTDOWN_REQUEST_FILE,
  TEAM_TASKS_DIRECTORY,
  TEAM_WORKERS_DIRECTORY,
} from "./constants"
import type {
  ExecutionManifest,
  ShutdownAck,
  ShutdownRequest,
  TeamConfig,
  TeamDispatchRequest,
  TaskApprovalRecord,
  TeamMonitorSnapshot,
  WorkerMailbox,
  TeamTask,
  WorkerStatus,
} from "./types"

function ensureParentDirectory(filePath: string): void {
  const parent = dirname(filePath)
  if (parent && !existsSync(parent)) {
    mkdirSync(parent, { recursive: true })
  }
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown): boolean {
  try {
    ensureParentDirectory(filePath)
    writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

export function resolveTeamStateRoot(projectDirectory: string, explicitRoot?: string): string {
  return explicitRoot ?? join(projectDirectory, DEFAULT_TEAM_STATE_ROOT)
}

export function getTeamDirectory(teamStateRoot: string, teamName: string): string {
  return join(teamStateRoot, TEAM_DIRECTORY_NAME, teamName)
}

export function getTeamConfigPath(teamStateRoot: string, teamName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_CONFIG_FILE)
}

export function getExecutionManifestPath(teamStateRoot: string, teamName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_MANIFEST_FILE)
}

export function getDispatchRequestsPath(teamStateRoot: string, teamName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_DISPATCH_DIRECTORY, TEAM_DISPATCH_REQUESTS_FILE)
}

export function getMailboxPath(teamStateRoot: string, teamName: string, workerName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_MAILBOX_DIRECTORY, `${workerName}.json`)
}

export function getTaskApprovalPath(teamStateRoot: string, teamName: string, taskId: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_APPROVALS_DIRECTORY, `task-${taskId}.json`)
}

export function getMonitorSnapshotPath(teamStateRoot: string, teamName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_MONITOR_SNAPSHOT_FILE)
}

export function getTaskPath(teamStateRoot: string, teamName: string, taskId: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_TASKS_DIRECTORY, `task-${taskId}.json`)
}

export function getWorkerStatusPath(teamStateRoot: string, teamName: string, workerName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_WORKERS_DIRECTORY, workerName, "status.json")
}

export function getShutdownRequestPath(teamStateRoot: string, teamName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_SHUTDOWN_REQUEST_FILE)
}

export function getShutdownAckPath(teamStateRoot: string, teamName: string, workerName: string): string {
  return join(getTeamDirectory(teamStateRoot, teamName), TEAM_SHUTDOWN_ACKS_DIRECTORY, `${workerName}.json`)
}

export function readTeamConfig(teamStateRoot: string, teamName: string): TeamConfig | null {
  return readJsonFile<TeamConfig>(getTeamConfigPath(teamStateRoot, teamName))
}

export function writeTeamConfig(teamStateRoot: string, teamName: string, config: TeamConfig): boolean {
  return writeJsonFile(getTeamConfigPath(teamStateRoot, teamName), config)
}

export function readExecutionManifest(teamStateRoot: string, teamName: string): ExecutionManifest | null {
  return readJsonFile<ExecutionManifest>(getExecutionManifestPath(teamStateRoot, teamName))
}

export function writeExecutionManifest(
  teamStateRoot: string,
  teamName: string,
  manifest: ExecutionManifest,
): boolean {
  return writeJsonFile(getExecutionManifestPath(teamStateRoot, teamName), manifest)
}

export function readDispatchRequests(teamStateRoot: string, teamName: string): TeamDispatchRequest[] {
  return readJsonFile<TeamDispatchRequest[]>(getDispatchRequestsPath(teamStateRoot, teamName)) ?? []
}

export function writeDispatchRequests(
  teamStateRoot: string,
  teamName: string,
  requests: TeamDispatchRequest[],
): boolean {
  return writeJsonFile(getDispatchRequestsPath(teamStateRoot, teamName), requests)
}

export function readMailbox(teamStateRoot: string, teamName: string, workerName: string): WorkerMailbox | null {
  return readJsonFile<WorkerMailbox>(getMailboxPath(teamStateRoot, teamName, workerName))
}

export function writeMailbox(
  teamStateRoot: string,
  teamName: string,
  workerName: string,
  mailbox: WorkerMailbox,
): boolean {
  return writeJsonFile(getMailboxPath(teamStateRoot, teamName, workerName), mailbox)
}

export function readTeamTask(teamStateRoot: string, teamName: string, taskId: string): TeamTask | null {
  return readJsonFile<TeamTask>(getTaskPath(teamStateRoot, teamName, taskId))
}

export function writeTeamTask(teamStateRoot: string, teamName: string, task: TeamTask): boolean {
  return writeJsonFile(getTaskPath(teamStateRoot, teamName, task.id), task)
}

export function readTaskApproval(
  teamStateRoot: string,
  teamName: string,
  taskId: string,
): TaskApprovalRecord | null {
  return readJsonFile<TaskApprovalRecord>(getTaskApprovalPath(teamStateRoot, teamName, taskId))
}

export function writeTaskApproval(
  teamStateRoot: string,
  teamName: string,
  taskId: string,
  approval: TaskApprovalRecord,
): boolean {
  return writeJsonFile(getTaskApprovalPath(teamStateRoot, teamName, taskId), approval)
}

export function listTeamTasks(teamStateRoot: string, teamName: string): TeamTask[] {
  const tasksDirectory = join(getTeamDirectory(teamStateRoot, teamName), TEAM_TASKS_DIRECTORY)
  if (!existsSync(tasksDirectory)) {
    return []
  }

  return readdirSync(tasksDirectory)
    .filter((entry) => entry.startsWith("task-") && entry.endsWith(".json"))
    .map((entry) => readJsonFile<TeamTask>(join(tasksDirectory, entry)))
    .filter((entry): entry is TeamTask => entry !== null)
    .sort((left, right) => Number(left.id) - Number(right.id))
}

export function readWorkerStatus(teamStateRoot: string, teamName: string, workerName: string): WorkerStatus | null {
  return readJsonFile<WorkerStatus>(getWorkerStatusPath(teamStateRoot, teamName, workerName))
}

export function writeWorkerStatus(
  teamStateRoot: string,
  teamName: string,
  workerName: string,
  status: WorkerStatus,
): boolean {
  return writeJsonFile(getWorkerStatusPath(teamStateRoot, teamName, workerName), status)
}

export function readMonitorSnapshot(teamStateRoot: string, teamName: string): TeamMonitorSnapshot | null {
  return readJsonFile<TeamMonitorSnapshot>(getMonitorSnapshotPath(teamStateRoot, teamName))
}

export function writeMonitorSnapshot(
  teamStateRoot: string,
  teamName: string,
  snapshot: TeamMonitorSnapshot,
): boolean {
  return writeJsonFile(getMonitorSnapshotPath(teamStateRoot, teamName), snapshot)
}

export function readShutdownRequest(teamStateRoot: string, teamName: string): ShutdownRequest | null {
  return readJsonFile<ShutdownRequest>(getShutdownRequestPath(teamStateRoot, teamName))
}

export function writeShutdownRequest(
  teamStateRoot: string,
  teamName: string,
  request: ShutdownRequest,
): boolean {
  return writeJsonFile(getShutdownRequestPath(teamStateRoot, teamName), request)
}

export function readShutdownAck(teamStateRoot: string, teamName: string, workerName: string): ShutdownAck | null {
  return readJsonFile<ShutdownAck>(getShutdownAckPath(teamStateRoot, teamName, workerName))
}

export function writeShutdownAck(
  teamStateRoot: string,
  teamName: string,
  workerName: string,
  ack: ShutdownAck,
): boolean {
  return writeJsonFile(getShutdownAckPath(teamStateRoot, teamName, workerName), ack)
}
