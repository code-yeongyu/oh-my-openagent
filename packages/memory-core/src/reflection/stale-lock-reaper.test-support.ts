import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

import { buildIdentityPaths, type MemoryIdentityPaths } from "../identity"
import { getProcessStartIdentity } from "../locks/process-identity"

const roots: string[] = []

export function cleanupReaperFixtures(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 })
}

export const NOW = Date.parse("2026-11-05T06:00:00.000Z")
export const HOST = "reaper-host"
export const RUN = "reflection-run-64"

export function reaperIdentity(id = "agent-a"): MemoryIdentityPaths {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-stale-lock-reaper-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, id)
  mkdirSync(paths.repo, { recursive: true })
  mkdirSync(paths.reflection, { recursive: true })
  return paths
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

export function activeLock(paths: MemoryIdentityPaths, fields: Record<string, unknown> = {}): Record<string, unknown> {
  const record = {
    runId: RUN,
    request: { trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] },
    reservedAt: new Date(NOW - 10 * 60_000).toISOString(),
    launcherPid: 11096,
    launcherHostname: HOST,
    launcherProcessStart: null,
    ...fields,
  }
  writeJson(join(paths.reflection, "active.lock"), record)
  return record
}

export function pendingRun(paths: MemoryIdentityPaths, runId = "reflection-run-65"): void {
  writeJson(join(paths.reflection, "pending.json"), { runId, request: { trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] } })
}

export function validLedger(runId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    runId,
    kind: "reflection",
    trigger: "manual",
    startedAt: new Date(NOW - 9 * 60_000).toISOString(),
    hardDeadlineAt: NOW - 60_000,
    terminationGraceMs: 100,
    deadlineAt: NOW - 60_000 + 100,
    mergePolicy: "auto",
    pid: 4201,
    processStart: null,
    childPid: 4202,
    childProcessStart: null,
    worktreeDir: "/nonexistent/worktree",
    worktreeBranch: `reflection/${runId}`,
    baseSha: "0".repeat(40),
    gitFilePath: "/nonexistent/worktree/.git",
    gitFileSnapshot: "gitdir: /nonexistent",
    commonConfigPath: "/nonexistent/config",
    commonConfigSnapshot: null,
    ...fields,
  }
}

export function runDir(paths: MemoryIdentityPaths, runId: string): string {
  return join(paths.reflection, "runs", runId)
}

export function age(path: string, ms: number): void {
  const at = new Date(NOW - ms)
  utimesSync(path, at, at)
}

export function treeHash(root: string): string {
  const hash = createHash("sha256")
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      hash.update(`${relative(root, path)}\n`)
      if (entry.isDirectory()) walk(path)
      else hash.update(readFileSync(path))
    }
  }
  walk(root)
  return hash.digest("hex")
}

export async function killedChild(): Promise<{ readonly pid: number; readonly start: string | null }> {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" })
  const pid = child.pid
  if (pid === undefined) throw new Error("child did not start")
  const start = await getProcessStartIdentity(pid)
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill("SIGKILL")
  await exited
  return { pid, start }
}

export const THIS_HOST = hostname()
