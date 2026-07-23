import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "./record-store"
import { StatePermissionsError } from "./state-permissions"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test.skipIf(process.platform === "win32")("#given a fresh store #when records and logs are first written #then state directories are owner-only", () => {
  // given
  const project = mkdtempSync(join(tmpdir(), "senpi-task-permissions-"))
  roots.push(project)
  const store = createTaskRecordStore({ project_dir: project })
  const record = createTaskRecord({
    parent_session_id: "parent-session",
    root_session_id: "parent-session",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-5.6-sol",
  })

  // when
  store.save(record)
  store.appendEvent(record.task_id, { type: "probe", payload: {} })

  // then
  expect(statSync(join(store.stateDir, "tasks")).mode & 0o777).toBe(0o700)
  expect(statSync(join(store.stateDir, "logs")).mode & 0o777).toBe(0o700)
})

test.skipIf(process.platform === "win32")("#given state_dir '.' with unrelated paths #when the store initializes #then it does not mutate them", () => {
  // given
  const project = mkdtempSync(join(tmpdir(), "senpi-task-permissions-"))
  roots.push(project)
  const unrelatedDir = join(project, "unrelated")
  const unrelatedFile = join(unrelatedDir, "note.txt")
  const externalDir = join(project, "external")
  const externalFile = join(externalDir, "target.txt")
  mkdirSync(unrelatedDir, { recursive: true, mode: 0o755 })
  mkdirSync(externalDir, { mode: 0o755 })
  writeFileSync(unrelatedFile, "keep", { mode: 0o644 })
  writeFileSync(externalFile, "keep", { mode: 0o644 })
  symlinkSync(externalDir, join(project, "external-link"))
  chmodSync(project, 0o755)
  chmodSync(unrelatedDir, 0o755)
  chmodSync(unrelatedFile, 0o644)
  chmodSync(externalDir, 0o755)
  chmodSync(externalFile, 0o644)
  const originalCwd = process.cwd()

  // when
  process.chdir(project)
  try {
    createTaskRecordStore({ project_dir: project, task: { state_dir: "." } })
  } finally {
    process.chdir(originalCwd)
  }

  // then
  expect(statSync(project).mode & 0o777).toBe(0o755)
  expect(statSync(unrelatedDir).mode & 0o777).toBe(0o755)
  expect(statSync(unrelatedFile).mode & 0o777).toBe(0o644)
  expect(statSync(externalDir).mode & 0o777).toBe(0o755)
  expect(statSync(externalFile).mode & 0o777).toBe(0o644)
})

test.skipIf(process.platform === "win32")("#given a symlinked tasks directory #when records are listed #then the external target is unchanged", () => {
  // given
  const project = mkdtempSync(join(tmpdir(), "senpi-task-task-symlink-"))
  roots.push(project)
  const store = createTaskRecordStore({ project_dir: project })
  const outsideDir = join(project, "outside-tasks")
  mkdirSync(outsideDir, { mode: 0o755 })
  mkdirSync(store.stateDir, { recursive: true, mode: 0o700 })
  symlinkSync(outsideDir, join(store.stateDir, "tasks"))

  // when / then
  expect(() => store.list()).toThrow(StatePermissionsError)
  expect(statSync(outsideDir).mode & 0o777).toBe(0o755)
})

test.skipIf(process.platform === "win32")("#given a symlinked record path #when a record is saved #then it rejects before replacing it", () => {
  // given
  const project = mkdtempSync(join(tmpdir(), "senpi-task-record-symlink-"))
  roots.push(project)
  const store = createTaskRecordStore({ project_dir: project })
  const record = createTaskRecord({
    parent_session_id: "parent-session",
    root_session_id: "parent-session",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-5.6-sol",
  })
  const outsideFile = join(project, "outside-record.json")
  writeFileSync(outsideFile, "outside", { mode: 0o644 })
  mkdirSync(join(store.stateDir, "tasks"), { recursive: true, mode: 0o700 })
  symlinkSync(outsideFile, join(store.stateDir, "tasks", `${record.task_id}.json`))

  // when / then
  expect(() => store.save(record)).toThrow(StatePermissionsError)
  expect(statSync(outsideFile).mode & 0o777).toBe(0o644)
})

test.skipIf(process.platform === "win32")("#given a symlinked logs directory #when an event is appended #then the external target is unchanged", () => {
  // given
  const project = mkdtempSync(join(tmpdir(), "senpi-task-log-symlink-"))
  roots.push(project)
  const store = createTaskRecordStore({ project_dir: project })
  const outsideDir = join(project, "outside-logs")
  mkdirSync(outsideDir, { mode: 0o755 })
  mkdirSync(store.stateDir, { recursive: true, mode: 0o700 })
  symlinkSync(outsideDir, join(store.stateDir, "logs"))
  const record = createTaskRecord({
    parent_session_id: "parent-session",
    root_session_id: "parent-session",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-5.6-sol",
  })

  // when / then
  expect(() => store.appendEvent(record.task_id, { type: "probe", payload: {} })).toThrow(StatePermissionsError)
  expect(statSync(outsideDir).mode & 0o777).toBe(0o755)
})
