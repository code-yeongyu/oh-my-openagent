import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ownHostedTaskId } from "./own-task-identity"

const TASK_ID = "st_0000c0de"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function realStore(): { root: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), "own-task-identity-"))
  roots.push(root)
  const store = join(root, "proj", "senpi-task")
  mkdirSync(join(store, "children", TASK_ID), { recursive: true })
  return { root, store }
}

function piWith(context: Record<string, string>): unknown {
  return { sessionContext: context }
}

describe("ownHostedTaskId", () => {
  test("#given a state_dir that is exactly <store>/children/<task id> on disk #then it answers the task id", () => {
    const { store } = realStore()
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: join(store, "children", TASK_ID) }), store)).toBe(TASK_ID)
  })

  test("#given a lookalike state_dir whose middle folder is not children #then it answers undefined", () => {
    const { store } = realStore()
    mkdirSync(join(store, "tasks", TASK_ID), { recursive: true })
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: join(store, "tasks", TASK_ID) }), store)).toBeUndefined()
  })

  test("#given a state_dir one folder deeper than children/<task id> #then it answers undefined", () => {
    const { store } = realStore()
    const deeper = join(store, "children", "nested", TASK_ID)
    mkdirSync(deeper, { recursive: true })
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: deeper }), store)).toBeUndefined()
  })

  test("#given a task id that is a path step (..) #then it answers undefined", () => {
    const { store } = realStore()
    expect(ownHostedTaskId(piWith({ task_id: "..", state_dir: `${store}/children/..` }), store)).toBeUndefined()
  })

  test("#given the engine store spelled through a symlink (darwin /tmp -> /private/tmp) #then the same store still matches", () => {
    const { root, store } = realStore()
    const alias = join(root, "alias-store")
    symlinkSync(store, alias)
    const childDir = join(store, "children", TASK_ID)
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: childDir }), alias)).toBe(TASK_ID)
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: join(alias, "children", TASK_ID) }), store)).toBe(TASK_ID)
  })

  test("#given a child dir not created yet under a symlinked store #then it still matches through the store's real path", () => {
    const { root, store } = realStore()
    const alias = join(root, "alias-store")
    symlinkSync(store, alias)
    expect(ownHostedTaskId(piWith({ task_id: "st_notyet", state_dir: join(alias, "children", "st_notyet") }), store)).toBe("st_notyet")
  })

  test("#given <store>/children/<task id> is a dangling symlink pointing outside the store #then it answers undefined", () => {
    const { root, store } = realStore()
    const childDir = join(store, "children", "st_dangling")
    symlinkSync(join(root, "outside", "gone"), childDir)
    expect(ownHostedTaskId(piWith({ task_id: "st_dangling", state_dir: childDir }), store)).toBeUndefined()
  })

  test("#given the store's children folder is itself a symlink elsewhere #then a child under it answers undefined (fails closed to the session-id match)", () => {
    const { root } = realStore()
    const store = join(root, "linked", "senpi-task")
    const elsewhere = join(root, "elsewhere-children")
    mkdirSync(join(elsewhere, TASK_ID), { recursive: true })
    mkdirSync(store, { recursive: true })
    symlinkSync(elsewhere, join(store, "children"))
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: join(store, "children", TASK_ID) }), store)).toBeUndefined()
    expect(ownHostedTaskId(piWith({ task_id: "st_notyet", state_dir: join(store, "children", "st_notyet") }), store)).toBeUndefined()
  })

  test("#given a state_dir whose path runs through a regular file (ENOTDIR) #then it answers undefined instead of throwing", () => {
    const { store } = realStore()
    writeFileSync(join(store, "children", "st_file"), "")
    expect(ownHostedTaskId(piWith({ task_id: "x", state_dir: join(store, "children", "st_file", "x") }), store)).toBeUndefined()
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: join(store, "children", TASK_ID) }), join(store, "children", "st_file", "x"))).toBeUndefined()
  })

  test("#given a real state_dir inside another store #then it answers undefined", () => {
    const mine = realStore()
    const other = realStore()
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: join(other.store, "children", TASK_ID) }), mine.store)).toBeUndefined()
  })

  test("#given a context with no state_dir #then it answers undefined", () => {
    const { store } = realStore()
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID }), store)).toBeUndefined()
  })

  test("#given an empty engine state dir #then it answers undefined", () => {
    const { store } = realStore()
    expect(ownHostedTaskId(piWith({ task_id: TASK_ID, state_dir: join(store, "children", TASK_ID) }), "")).toBeUndefined()
  })
})
