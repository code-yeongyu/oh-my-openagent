import { describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LSP_STATUS_SCHEMA_VERSION } from "./constants"
import { readLspDaemonStatus } from "./lsp-status-reader"

function withBase(run: (baseDir: string) => void): void {
  const baseDir = mkdtempSync(join(tmpdir(), "omo-lsp-status-reader-"))
  try {
    run(baseDir)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
}

function writeStatus(baseDir: string, versionDir: string, payload: unknown): void {
  const dir = join(baseDir, versionDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "status.json"), JSON.stringify(payload))
}

function status(updatedAt: number, serverId: string) {
  return {
    version: LSP_STATUS_SCHEMA_VERSION,
    updatedAt,
    pid: 42354,
    clients: [{ serverId, root: "/abs/path", alive: true, isInitializing: false, refCount: 1 }],
  }
}

describe("readLspDaemonStatus", () => {
  it("returns empty for missing, invalid, wrong-version, and stale status", () => {
    expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: "/path/that/does/not/exist" })).toEqual([])
    withBase((baseDir) => {
      writeStatus(baseDir, "v1", { invalid: true })
      expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: baseDir })).toEqual([])
      writeFileSync(join(baseDir, "v1", "status.json"), "{")
      expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: baseDir })).toEqual([])
      writeStatus(baseDir, "v1", { ...status(Date.now(), "typescript"), version: 2 })
      expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: baseDir })).toEqual([])
      writeStatus(baseDir, "v1", status(Date.now() - 15_001, "typescript"))
      expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: baseDir })).toEqual([])
    })
  })

  it("picks freshest and maps alive, initializing, and dead clients", () => {
    withBase((baseDir) => {
      writeStatus(baseDir, "v1", status(Date.now() - 1_000, "older"))
      writeStatus(baseDir, "v2", {
        ...status(Date.now(), "typescript"),
        clients: [
          { serverId: "typescript", root: "/ts", alive: true, isInitializing: true, refCount: 2 },
          { serverId: "eslint", root: "/eslint", alive: true, isInitializing: false, refCount: 1 },
          { serverId: "dead", root: "/dead", alive: false, isInitializing: false, refCount: 0 },
        ],
      })
      expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: baseDir })).toEqual([
        { serverId: "typescript", root: "/ts", state: "initializing", refCount: 2 },
        { serverId: "eslint", root: "/eslint", state: "alive", refCount: 1 },
        { serverId: "dead", root: "/dead", state: "dead", refCount: 0 },
      ])
    })
  })

  it("honors absolute overrides and ignores relative overrides", () => {
    withBase((baseDir) => {
      writeStatus(baseDir, "v1", status(Date.now(), "absolute"))
      expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: baseDir })[0]?.serverId).toBe("absolute")
      expect(readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: "relative/path" })).toEqual([])
    })
  })

  it("rethrows non-Error filesystem failures", () => {
    const readdirSyncSpy = spyOn(fs, "readdirSync").mockImplementation(() => {
      throw "readdir failed"
    })
    try {
      expect(() => readLspDaemonStatus({ OMO_LSP_DAEMON_DIR: "/tmp/lsp-daemon" })).toThrow("readdir failed")
    } finally {
      readdirSyncSpy.mockRestore()
    }
  })
})
