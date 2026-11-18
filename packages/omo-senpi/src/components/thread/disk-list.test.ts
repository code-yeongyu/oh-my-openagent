import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listDiskSessions } from "./disk-list"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sessionId(index: number): string {
  return `0195f0c2-1a2b-7c3d-8e4f-${index.toString(16).padStart(12, "0")}`
}

function writeSession(directory: string, index: number, modifiedSeconds: number): string {
  const created = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString()
  const id = sessionId(index)
  const path = join(directory, `${created.replace(/[:.]/g, "-")}_${id}.jsonl`)
  writeFileSync(path, `${JSON.stringify({ type: "session", id, cwd: "/tmp/workspace", timestamp: created })}\n`)
  utimesSync(path, modifiedSeconds, modifiedSeconds)
  return id
}

describe("listDiskSessions", () => {
  test("#given more session files than one listing stats #when listed with all_scope #then only the newest files by name are ranked by modification time, and the listing says it is truncated", () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "disk-list-"))
    dirs.push(sessionsDir)
    const directory = join(sessionsDir, "--tmp-workspace--")
    mkdirSync(directory)
    const base = 1_800_000_000
    // The oldest file by name was touched last: a listing that stats every file ranks it first.
    const oldest = writeSession(directory, 0, base + 10_000)
    const newest: string[] = []
    for (let index = 1; index <= 1000; index += 1) newest.push(writeSession(directory, index, base + index))

    const listed = listDiskSessions(sessionsDir, { all_scope: true })

    const ids = listed.sessions.map((session) => session.durable_id)
    expect(listed.truncated).toBe(true)
    expect(ids).toHaveLength(200)
    expect(ids).not.toContain(oldest)
    expect(ids).toEqual(newest.slice(-200).reverse())
  })

  test("#given a few session files #when listed #then every one is read, newest modification first, and nothing is truncated", () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "disk-list-"))
    dirs.push(sessionsDir)
    const directory = join(sessionsDir, "--tmp-workspace--")
    mkdirSync(directory)
    const base = 1_800_000_000
    const first = writeSession(directory, 0, base + 30)
    const second = writeSession(directory, 1, base + 10)
    const third = writeSession(directory, 2, base + 20)

    const listed = listDiskSessions(sessionsDir, { all_scope: true })

    expect(listed.truncated).toBe(false)
    expect(listed.sessions.map((session) => session.durable_id)).toEqual([first, third, second])
  })
})
