import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getDispatchRequestsPath,
  getExecutionManifestPath,
  getMailboxPath,
  getMonitorSnapshotPath,
  getShutdownAckPath,
  getShutdownRequestPath,
  getTaskApprovalPath,
  getTaskPath,
  getTeamConfigPath,
  getTeamDirectory,
  getWorkerStatusPath,
  listTeamTasks,
  readDispatchRequests,
  readExecutionManifest,
  readMailbox,
  readMonitorSnapshot,
  readShutdownAck,
  readShutdownRequest,
  readTaskApproval,
  readTeamConfig,
  readTeamTask,
  readWorkerStatus,
  resolveTeamStateRoot,
  writeDispatchRequests,
  writeExecutionManifest,
  writeMailbox,
  writeMonitorSnapshot,
  writeShutdownAck,
  writeShutdownRequest,
  writeTaskApproval,
  writeTeamConfig,
  writeTeamTask,
  writeWorkerStatus,
} from "./storage"
import type {
  ExecutionManifest,
  ShutdownAck,
  ShutdownRequest,
  TeamConfig,
  TeamDispatchRequest,
  TaskApprovalRecord,
  TeamMessage,
  TeamMonitorSnapshot,
  TeamTask,
  WorkerStatus,
  WorkerMailbox,
} from "./types"

describe("team-state storage", () => {
  const projectDirectory = join(tmpdir(), `team-state-${Date.now()}`)
  const teamName = "atlas-team"
  let teamStateRoot: string

  beforeEach(() => {
    if (!existsSync(projectDirectory)) {
      mkdirSync(projectDirectory, { recursive: true })
    }
    teamStateRoot = resolveTeamStateRoot(projectDirectory)
  })

  afterEach(() => {
    rmSync(projectDirectory, { recursive: true, force: true })
  })

  test("resolves default team state root under project directory", () => {
    expect(teamStateRoot).toBe(join(projectDirectory, ".omx/state"))
    expect(getTeamDirectory(teamStateRoot, teamName)).toBe(join(projectDirectory, ".omx/state/team/atlas-team"))
  })

  test("writes and reads team config plus execution manifest", () => {
    const config: TeamConfig = {
      name: teamName,
      task: "Ship team mode",
      agent_type: "executor",
      worker_launch_mode: "interactive",
      worker_count: 2,
      workers: [{ name: "worker-1", index: 1, role: "executor" }],
      created_at: "2026-03-15T00:00:00.000Z",
    }
    const manifest: ExecutionManifest = {
      schema_version: 2,
      name: teamName,
      task: "Ship team mode",
      worker_count: 2,
      workers: [{ name: "worker-1", index: 1, role: "executor" }],
      created_at: "2026-03-15T00:00:00.000Z",
      leader: { worker_id: "leader-fixed", role: "coordinator" },
    }

    expect(writeTeamConfig(teamStateRoot, teamName, config)).toBe(true)
    expect(writeExecutionManifest(teamStateRoot, teamName, manifest)).toBe(true)
    expect(readTeamConfig(teamStateRoot, teamName)).toEqual(config)
    expect(readExecutionManifest(teamStateRoot, teamName)).toEqual(manifest)
    expect(getTeamConfigPath(teamStateRoot, teamName)).toContain("config.json")
    expect(getExecutionManifestPath(teamStateRoot, teamName)).toContain("manifest.v2.json")
  })

  test("writes and lists numerically sorted task files", () => {
    const task10: TeamTask = {
      id: "10",
      subject: "later",
      description: "later",
      status: "pending",
      owner: "worker-2",
      role: "executor",
      depends_on: [],
      version: 1,
      created_at: "2026-03-15T00:00:10.000Z",
    }
    const task2: TeamTask = {
      id: "2",
      subject: "earlier",
      description: "earlier",
      status: "pending",
      owner: "worker-1",
      role: "executor",
      depends_on: [],
      version: 1,
      created_at: "2026-03-15T00:00:02.000Z",
    }

    writeTeamTask(teamStateRoot, teamName, task10)
    writeTeamTask(teamStateRoot, teamName, task2)

    expect(readTeamTask(teamStateRoot, teamName, "10")).toEqual(task10)
    expect(listTeamTasks(teamStateRoot, teamName).map((task) => task.id)).toEqual(["2", "10"])
    expect(getTaskPath(teamStateRoot, teamName, "2")).toContain("task-2.json")
  })

  test("writes and reads worker status, monitor snapshot, and shutdown files", () => {
    const workerStatus: WorkerStatus = {
      state: "blocked",
      updated_at: "2026-03-15T00:00:00.000Z",
      reason: "waiting on leader",
    }
    const snapshot: TeamMonitorSnapshot = {
      timestamp: "2026-03-15T00:05:00.000Z",
      team_name: teamName,
      worker_count: 2,
      active_workers: 1,
      pending_tasks: 3,
    }
    const shutdownRequest: ShutdownRequest = {
      requested_at: "2026-03-15T00:10:00.000Z",
      requested_by: "leader-fixed",
      reason: "verification complete",
    }
    const shutdownAck: ShutdownAck = {
      worker: "worker-1",
      acknowledged_at: "2026-03-15T00:10:30.000Z",
      status: "idle",
    }

    expect(writeWorkerStatus(teamStateRoot, teamName, "worker-1", workerStatus)).toBe(true)
    expect(writeMonitorSnapshot(teamStateRoot, teamName, snapshot)).toBe(true)
    expect(writeShutdownRequest(teamStateRoot, teamName, shutdownRequest)).toBe(true)
    expect(writeShutdownAck(teamStateRoot, teamName, "worker-1", shutdownAck)).toBe(true)
    expect(readWorkerStatus(teamStateRoot, teamName, "worker-1")).toEqual(workerStatus)
    expect(readMonitorSnapshot(teamStateRoot, teamName)).toEqual(snapshot)
    expect(readShutdownRequest(teamStateRoot, teamName)).toEqual(shutdownRequest)
    expect(readShutdownAck(teamStateRoot, teamName, "worker-1")).toEqual(shutdownAck)
    expect(getWorkerStatusPath(teamStateRoot, teamName, "worker-1")).toContain("workers/worker-1/status.json")
    expect(getMonitorSnapshotPath(teamStateRoot, teamName)).toContain("monitor-snapshot.json")
    expect(getShutdownRequestPath(teamStateRoot, teamName)).toContain("shutdown-request.json")
    expect(getShutdownAckPath(teamStateRoot, teamName, "worker-1")).toContain("shutdown-acks/worker-1.json")
  })

  test("writes and reads dispatch requests with empty fallback on missing file", () => {
    const requests: TeamDispatchRequest[] = [{
      request_id: "req-1",
      kind: "inbox",
      team_name: teamName,
      to_worker: "worker-1",
      created_at: "2026-03-15T00:00:00.000Z",
    }]

    expect(readDispatchRequests(teamStateRoot, teamName)).toEqual([])
    expect(writeDispatchRequests(teamStateRoot, teamName, requests)).toBe(true)
    expect(readDispatchRequests(teamStateRoot, teamName)).toEqual(requests)
    expect(getDispatchRequestsPath(teamStateRoot, teamName)).toContain("dispatch/requests.json")
    expect(getMailboxPath(teamStateRoot, teamName, "worker-1")).toContain("mailbox/worker-1.json")
  })

  test("writes and reads mailbox plus task approval records", () => {
    const messages: TeamMessage[] = [{
      message_id: "msg-1",
      from_worker: "leader-fixed",
      to_worker: "worker-1",
      body: "continue",
      created_at: "2026-03-15T00:00:00.000Z",
    }]
    const mailbox: WorkerMailbox = {
      worker: "worker-1",
      messages,
    }
    const approval: TaskApprovalRecord = {
      task_id: "7",
      approved_by: "leader-fixed",
      approved_at: "2026-03-15T00:20:00.000Z",
      note: "verified",
    }

    expect(writeMailbox(teamStateRoot, teamName, "worker-1", mailbox)).toBe(true)
    expect(writeTaskApproval(teamStateRoot, teamName, "7", approval)).toBe(true)
    expect(readMailbox(teamStateRoot, teamName, "worker-1")).toEqual(mailbox)
    expect(readTaskApproval(teamStateRoot, teamName, "7")).toEqual(approval)
    expect(getTaskApprovalPath(teamStateRoot, teamName, "7")).toContain("approvals/task-7.json")
  })

  test("returns null for invalid json payloads", () => {
    const invalidConfigPath = getTeamConfigPath(teamStateRoot, teamName)
    const invalidStatusPath = getWorkerStatusPath(teamStateRoot, teamName, "worker-1")
    mkdirSync(join(projectDirectory, ".omx/state/team/atlas-team/workers/worker-1"), { recursive: true })
    mkdirSync(join(projectDirectory, ".omx/state/team/atlas-team"), { recursive: true })
    writeFileSync(invalidConfigPath, "{oops", "utf-8")
    writeFileSync(invalidStatusPath, "{oops", "utf-8")

    expect(readTeamConfig(teamStateRoot, teamName)).toBeNull()
    expect(readWorkerStatus(teamStateRoot, teamName, "worker-1")).toBeNull()
  })
})
