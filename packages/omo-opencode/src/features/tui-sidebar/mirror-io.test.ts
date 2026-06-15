import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { MIRROR_DIR_NAME, MIRROR_SCHEMA_VERSION, STALE_MS } from "./constants"
import { readMirror, writeMirror } from "./mirror-io"
import { mirrorFilePath, mirrorStorageDir } from "./mirror-path"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-tui-${label}-`))
  tempDirs.push(dir)
  return dir
}

function snapshotFor(projectDir: string, updatedAt: number): TuiRuntimeSnapshot {
  return {
    version: MIRROR_SCHEMA_VERSION,
    projectDir: resolve(projectDir),
    updatedAt,
    activeAgents: [{ name: "sisyphus", status: "running" }],
    jobBoard: [
      {
        title: "Index repository",
        status: "running",
        toolCalls: 2,
        lastTool: "grep",
      },
    ],
    loop: null,
  }
}

function writeRawMirror(projectDir: string, raw: unknown): void {
  const filePath = mirrorFilePath(projectDir)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(raw), "utf-8")
}

describe("tui-sidebar mirror IPC", () => {
  beforeEach(() => {
    process.env.XDG_DATA_HOME = makeTempDir("xdg")
  })

  afterEach(() => {
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given XDG_DATA_HOME #when resolving storage #then it uses the preferred opencode mirror directory", () => {
    // given
    const xdgDataHome = process.env.XDG_DATA_HOME ?? ""

    // when
    const storageDir = mirrorStorageDir()

    // then
    expect(storageDir).toBe(
      join(xdgDataHome, "opencode", "storage", "oh-my-openagent", MIRROR_DIR_NAME),
    )
  })

  it("#given two project directories #when resolving mirror files #then they map to different files", () => {
    // given
    const projectA = makeTempDir("project-a")
    const projectB = makeTempDir("project-b")

    // when
    const fileA = mirrorFilePath(projectA)
    const fileB = mirrorFilePath(projectB)

    // then
    expect(fileA).not.toBe(fileB)
    expect(dirname(fileA)).toBe(mirrorStorageDir())
    expect(fileA.endsWith(".json")).toBe(true)
  })

  it("#given no mirror file #when reading #then it returns null", () => {
    // given
    const projectDir = makeTempDir("absent")

    // when
    const snapshot = readMirror(projectDir)

    // then
    expect(snapshot).toBeNull()
  })

  it("#given corrupt JSON #when reading #then it returns null", () => {
    // given
    const projectDir = makeTempDir("corrupt")
    const filePath = mirrorFilePath(projectDir)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, "{", "utf-8")

    // when
    const snapshot = readMirror(projectDir)

    // then
    expect(snapshot).toBeNull()
  })

  it("#given a version mismatch #when reading #then it returns null", () => {
    // given
    const projectDir = makeTempDir("version")
    writeRawMirror(projectDir, { ...snapshotFor(projectDir, Date.now()), version: 2 })

    // when
    const snapshot = readMirror(projectDir)

    // then
    expect(snapshot).toBeNull()
  })

  it("#given a foreign projectDir #when reading #then it returns null", () => {
    // given
    const projectDir = makeTempDir("local")
    const foreignDir = makeTempDir("foreign")
    writeRawMirror(projectDir, snapshotFor(foreignDir, Date.now()))

    // when
    const snapshot = readMirror(projectDir)

    // then
    expect(snapshot).toBeNull()
  })

  it("#given a stale snapshot #when reading #then it returns null", () => {
    // given
    const projectDir = makeTempDir("stale")
    writeRawMirror(projectDir, snapshotFor(projectDir, Date.now() - STALE_MS - 1))

    // when
    const snapshot = readMirror(projectDir)

    // then
    expect(snapshot).toBeNull()
  })

  it("#given a fresh same-project snapshot #when reading #then it returns the parsed snapshot", () => {
    // given
    const projectDir = makeTempDir("fresh")
    const expected = snapshotFor(projectDir, Date.now())
    writeRawMirror(projectDir, expected)

    // when
    const snapshot = readMirror(projectDir)

    // then
    expect(snapshot).toEqual(expected)
  })

  it("#given a valid snapshot #when writing then reading #then it round-trips through the per-project file", () => {
    // given
    const projectDir = makeTempDir("round-trip")
    const expected = snapshotFor(projectDir, Date.now())

    // when
    writeMirror(projectDir, expected)
    const snapshot = readMirror(projectDir)

    // then
    expect(snapshot).toEqual(expected)
    expect(existsSync(mirrorFilePath(projectDir))).toBe(true)
  })

  it("#given a valid snapshot #when writing #then the mirror file is private to the user", () => {
    // given
    const projectDir = makeTempDir("private-mode")
    const expected = snapshotFor(projectDir, Date.now())

    // when
    writeMirror(projectDir, expected)

    // then
    expect(readMirror(projectDir)).toEqual(expected)
    if (process.platform === "win32") {
      return
    }
    expect(statSync(mirrorFilePath(projectDir)).mode & 0o777).toBe(0o600)
  })

  it("#given mirror storage parent is a file #when writing #then it reports the filesystem failure", () => {
    // given
    const blockedDataHome = join(makeTempDir("blocked-parent"), "data-home-file")
    writeFileSync(blockedDataHome, "not a directory", "utf-8")
    process.env.XDG_DATA_HOME = blockedDataHome
    const projectDir = makeTempDir("write-failure")
    const snapshot = snapshotFor(projectDir, Date.now())

    expect(() => writeMirror(projectDir, snapshot)).toThrow()
  })
})
