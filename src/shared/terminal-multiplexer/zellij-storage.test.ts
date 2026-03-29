import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  loadZellijState,
  saveZellijState,
  clearZellijState,
} from "./zellij-storage"
import type { ZellijState } from "./zellij-storage"
import { getOpenCodeStorageDir } from "../data-path"

//#given a temporary storage directory for testing
let testStorageDir: string

beforeEach(() => {
  testStorageDir = join(tmpdir(), `zellij-storage-test-${Date.now()}`)
  const zellijStorageDir = join(getOpenCodeStorageDir(), 'zellij-adapter')
  if (existsSync(zellijStorageDir)) {
    rmSync(zellijStorageDir, { recursive: true, force: true })
  }
})

afterEach(() => {
  if (existsSync(testStorageDir)) {
    rmSync(testStorageDir, { recursive: true, force: true })
  }
  const zellijStorageDir = join(getOpenCodeStorageDir(), 'zellij-adapter')
  if (existsSync(zellijStorageDir)) {
    rmSync(zellijStorageDir, { recursive: true, force: true })
  }
})

describe("zellij-storage", () => {
  //#when loading state for a non-existent session
  //#then return null without throwing
  it("loadZellijState returns null for non-existent session", () => {
    const result = loadZellijState("non-existent-session")
    expect(result).toBeNull()
  })

  //#when saving a valid ZellijState
  //#then the state is persisted to disk
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

  //#when saving state with null anchorPaneId
  //#then the state is correctly persisted with null value
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

  //#when clearing state for an existing session
  //#then the state file is removed
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

  //#when clearing state for a non-existent session
  //#then no error is thrown
  it("clearZellijState handles non-existent session gracefully", () => {
    expect(() => {
      clearZellijState("non-existent-session")
    }).not.toThrow()
  })

  //#when loading corrupted JSON from storage
  //#then return null without throwing
  it("loadZellijState returns null for corrupted JSON", () => {
    const state: ZellijState = {
      sessionID: "test-session-4",
      anchorPaneId: "pane-789",
      hasCreatedFirstPane: true,
      updatedAt: Date.now(),
    }

    saveZellijState(state)

    // Corrupt the file by writing invalid JSON
    const fs = require("node:fs")
    const storagePath = join(
      require("node:os").homedir(),
      ".local/share/opencode/storage/zellij-adapter",
      "test-session-4.json",
    )
    if (existsSync(storagePath)) {
      fs.writeFileSync(storagePath, "{ invalid json }")
    }

    const result = loadZellijState("test-session-4")
    expect(result).toBeNull()
  })

  //#when saving multiple sessions
  //#then each session is stored independently
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

   //#when updating an existing session state
   //#then the new state overwrites the old one
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

   //#given a file with severely corrupted JSON (invalid syntax)
   //#when loading state
   //#then return null without throwing
   it("loadZellijState handles severely corrupted JSON gracefully", () => {
     const state: ZellijState = {
       sessionID: "corrupt-severe-test",
       anchorPaneId: "pane-xyz",
       hasCreatedFirstPane: true,
       updatedAt: Date.now(),
     }

     saveZellijState(state)

     // Corrupt the file with completely invalid JSON
     const fs = require("node:fs")
     const storagePath = join(
       require("node:os").homedir(),
       ".local/share/opencode/storage/zellij-adapter",
       "corrupt-severe-test.json",
     )
     if (existsSync(storagePath)) {
       fs.writeFileSync(storagePath, "{ invalid json ]]] garbage <<<>>>")
     }

     const result = loadZellijState("corrupt-severe-test")
     expect(result).toBeNull()
   })

   //#given a file with empty content
   //#when loading state
   //#then return null without throwing
   it("loadZellijState handles empty file gracefully", () => {
     const state: ZellijState = {
       sessionID: "empty-file-test",
       anchorPaneId: "pane-empty",
       hasCreatedFirstPane: true,
       updatedAt: Date.now(),
     }

     saveZellijState(state)

     // Empty the file
     const fs = require("node:fs")
     const storagePath = join(
       require("node:os").homedir(),
       ".local/share/opencode/storage/zellij-adapter",
       "empty-file-test.json",
     )
     if (existsSync(storagePath)) {
       fs.writeFileSync(storagePath, "")
     }

     const result = loadZellijState("empty-file-test")
     expect(result).toBeNull()
   })
})
