import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

let testStorageDir = join(tmpdir(), `zellij-storage-test-${Date.now()}`)

mock.module("../data-path", () => ({
  getOpenCodeStorageDir: () => testStorageDir,
}))

const { loadZellijState, saveZellijState, clearZellijState } = await import("./zellij-storage")
import type { ZellijState } from "./zellij-storage"

beforeEach(() => {
  testStorageDir = join(tmpdir(), `zellij-storage-test-${Date.now()}`)
})

afterEach(() => {
  if (existsSync(testStorageDir)) {
    rmSync(testStorageDir, { recursive: true, force: true })
  }
})

describe("zellij-storage", () => {
  it("loadZellijState returns null for non-existent session", () => {
    const result = loadZellijState("non-existent-session")
    expect(result).toBeNull()
  })

  it("saveZellijState persists state to disk", () => {
    const state: ZellijState = {
      sessionID: "test-session-1",
      anchorPaneId: "pane-123",
      hasCreatedFirstPane: true,
      updatedAt: Date.now(),
    }

    saveZellijState(state)

    const loaded = loadZellijState("test-session-1")
    expect(loaded).not.toBeNull()
    expect(loaded?.sessionID).toBe("test-session-1")
    expect(loaded?.anchorPaneId).toBe("pane-123")
    expect(loaded?.hasCreatedFirstPane).toBe(true)
    expect(loaded?.updatedAt).toBe(state.updatedAt)
  })

  it("saveZellijState handles null anchorPaneId", () => {
    const state: ZellijState = {
      sessionID: "test-session-2",
      anchorPaneId: null,
      hasCreatedFirstPane: false,
      updatedAt: Date.now(),
    }

    saveZellijState(state)

    const loaded = loadZellijState("test-session-2")
    expect(loaded?.anchorPaneId).toBeNull()
    expect(loaded?.hasCreatedFirstPane).toBe(false)
  })

  it("clearZellijState removes state file", () => {
    const state: ZellijState = {
      sessionID: "test-session-3",
      anchorPaneId: "pane-456",
      hasCreatedFirstPane: true,
      updatedAt: Date.now(),
    }

    saveZellijState(state)
    expect(loadZellijState("test-session-3")).not.toBeNull()

    clearZellijState("test-session-3")
    expect(loadZellijState("test-session-3")).toBeNull()
  })

  it("clearZellijState handles non-existent session gracefully", () => {
    expect(() => {
      clearZellijState("non-existent-session")
    }).not.toThrow()
  })

  it("loadZellijState returns null for corrupted JSON", () => {
    const state: ZellijState = {
      sessionID: "test-session-4",
      anchorPaneId: "pane-789",
      hasCreatedFirstPane: true,
      updatedAt: Date.now(),
    }

    saveZellijState(state)

    const storagePath = join(testStorageDir, "zellij-adapter", "test-session-4.json")
    expect(existsSync(storagePath)).toBe(true)
    writeFileSync(storagePath, "{ invalid json }")

    const result = loadZellijState("test-session-4")
    expect(result).toBeNull()
  })

  it("saveZellijState stores multiple sessions independently", () => {
    const state1: ZellijState = {
      sessionID: "session-a",
      anchorPaneId: "pane-a",
      hasCreatedFirstPane: true,
      updatedAt: 1000,
    }

    const state2: ZellijState = {
      sessionID: "session-b",
      anchorPaneId: "pane-b",
      hasCreatedFirstPane: false,
      updatedAt: 2000,
    }

    saveZellijState(state1)
    saveZellijState(state2)

    const loaded1 = loadZellijState("session-a")
    const loaded2 = loadZellijState("session-b")

    expect(loaded1?.anchorPaneId).toBe("pane-a")
    expect(loaded1?.updatedAt).toBe(1000)
    expect(loaded2?.anchorPaneId).toBe("pane-b")
    expect(loaded2?.updatedAt).toBe(2000)
  })

  it("saveZellijState overwrites existing state", () => {
    const state1: ZellijState = {
      sessionID: "update-test",
      anchorPaneId: "old-pane",
      hasCreatedFirstPane: false,
      updatedAt: 1000,
    }

    saveZellijState(state1)

    const state2: ZellijState = {
      sessionID: "update-test",
      anchorPaneId: "new-pane",
      hasCreatedFirstPane: true,
      updatedAt: 2000,
    }

    saveZellijState(state2)

    const loaded = loadZellijState("update-test")
    expect(loaded?.anchorPaneId).toBe("new-pane")
    expect(loaded?.hasCreatedFirstPane).toBe(true)
    expect(loaded?.updatedAt).toBe(2000)
  })

  it("loadZellijState handles severely corrupted JSON gracefully", () => {
    const state: ZellijState = {
      sessionID: "corrupt-severe-test",
      anchorPaneId: "pane-xyz",
      hasCreatedFirstPane: true,
      updatedAt: Date.now(),
    }

    saveZellijState(state)

    const storagePath = join(testStorageDir, "zellij-adapter", "corrupt-severe-test.json")
    expect(existsSync(storagePath)).toBe(true)
    writeFileSync(storagePath, "{ invalid json ]]] garbage <<<>>>")

    const result = loadZellijState("corrupt-severe-test")
    expect(result).toBeNull()
  })

  it("loadZellijState handles empty file gracefully", () => {
    const state: ZellijState = {
      sessionID: "empty-file-test",
      anchorPaneId: "pane-empty",
      hasCreatedFirstPane: true,
      updatedAt: Date.now(),
    }

    saveZellijState(state)

    const storagePath = join(testStorageDir, "zellij-adapter", "empty-file-test.json")
    expect(existsSync(storagePath)).toBe(true)
    writeFileSync(storagePath, "")

    const result = loadZellijState("empty-file-test")
    expect(result).toBeNull()
  })

  it("loadZellijState returns null for valid JSON with wrong shape", () => {
    const storagePath = join(testStorageDir, "zellij-adapter", "wrong-shape-test.json")
    mkdirSync(join(testStorageDir, "zellij-adapter"), { recursive: true })

    writeFileSync(storagePath, JSON.stringify({ foo: "bar", count: 42 }))
    expect(loadZellijState("wrong-shape-test")).toBeNull()

    writeFileSync(storagePath, JSON.stringify({ sessionID: 123, anchorPaneId: null, hasCreatedFirstPane: true, updatedAt: 1000 }))
    expect(loadZellijState("wrong-shape-test")).toBeNull()

    writeFileSync(storagePath, JSON.stringify({ sessionID: "ok", anchorPaneId: null, hasCreatedFirstPane: "not-bool", updatedAt: 1000 }))
    expect(loadZellijState("wrong-shape-test")).toBeNull()

    writeFileSync(storagePath, JSON.stringify([1, 2, 3]))
    expect(loadZellijState("wrong-shape-test")).toBeNull()
  })
})
