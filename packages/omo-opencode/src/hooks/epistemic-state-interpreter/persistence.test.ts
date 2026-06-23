import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, readFileSync, existsSync, rmSync, chmodSync, writeFileSync } from "fs"
import { join } from "path"
import { setTimeout as setTimeoutPromise } from "timers/promises"
import * as loggerModule from "../../shared/logger"
import { loadPersistedState, persistState } from "./persistence"
import type { PersistedSessionState } from "./persistence-types"

const TMP_ROOT = ".tmp-test-persistence"

let testDir = ""
let originalCwd = process.cwd()

const makeState = (sessionID: string, updatedAt: number): PersistedSessionState => ({
  sessionID,
  updatedAt,
  conclusions: {
    c1: {
      currentState: "accepted",
      entries: [{ classification: "accepted", timestamp: updatedAt, callID: "c1" }],
      consecutiveCount: 2,
      lastSeenInvocation: 0,
      exclusionTheoryHash: undefined,
    },
  },
})

beforeEach(() => {
  originalCwd = process.cwd()
  testDir = join(TMP_ROOT, `${Date.now()}-${crypto.randomUUID()}`)
  mkdirSync(testDir, { recursive: true })
  process.chdir(testDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(TMP_ROOT, { recursive: true, force: true })
})

describe("persistence", () => {
  describe("#given a normal write", () => {
    it("#when persisted then loads the same state", async () => {
      const state = makeState("s1", 111)
      persistState("s1", state)
      await setTimeoutPromise(10)

      expect(loadPersistedState("s1")).toEqual(state)
    })

    it("#when persisted then creates the storage directory", async () => {
      persistState("s2", makeState("s2", 222))
      await setTimeoutPromise(10)

      expect(existsSync(join(".sisyphus", "epistemic"))).toBe(true)
    })

    it("#when persisted then creates the metadata file", async () => {
      persistState("s3", makeState("s3", 333))
      await setTimeoutPromise(10)

      expect(existsSync(join(".sisyphus", "epistemic", "_metadata.json"))).toBe(true)
    })
  })

  describe("#given bad reads", () => {
    it("#when the file is missing then returns null", () => {
      expect(loadPersistedState("missing")).toBeNull()
    })

    it("#when the file contains invalid JSON then returns null", () => {
      mkdirSync(join(".sisyphus", "epistemic"), { recursive: true })
      const filePath = join(".sisyphus", "epistemic", "broken.json")
      writeFileSync(filePath, "{broken", "utf-8")
      const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      expect(loadPersistedState("broken")).toBeNull()
      expect(stderrSpy).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[epistemic] load failed"),
        expect.objectContaining({ sessionID: "broken" }),
      )

      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })

    it("#when the file has invalid structure then returns null", () => {
      mkdirSync(join(".sisyphus", "epistemic"), { recursive: true })
      const filePath = join(".sisyphus", "epistemic", "bad.json")
      writeFileSync(filePath, JSON.stringify({ updatedAt: 1, conclusions: {} }), "utf-8")
      const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      expect(loadPersistedState("bad")).toBeNull()
      expect(stderrSpy).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[epistemic] corrupted state file"),
        expect.objectContaining({ sessionID: "bad" }),
      )

      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given a write failure", () => {
    it("#when disk writes fail then persistState does not throw", async () => {
      mkdirSync(join(".sisyphus", "epistemic"), { recursive: true })
      chmodSync(join(".sisyphus", "epistemic"), 0o500)
      const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      expect(() => persistState("blocked", makeState("blocked", 444))).not.toThrow()
      await setTimeoutPromise(10)
      expect(stderrSpy).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[epistemic] persist failed"),
        expect.objectContaining({ sessionID: "blocked" }),
      )

      chmodSync(join(".sisyphus", "epistemic"), 0o700)
      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given multiple writes", () => {
    it("#when persisted twice then preserves metadata createdAt", async () => {
      persistState("s4", makeState("s4", 111))
      await setTimeoutPromise(10)
      const metaPath = join(".sisyphus", "epistemic", "_metadata.json")
      const firstMeta = JSON.parse(readFileSync(metaPath, "utf-8")) as { createdAt: number; lastUpdated: number }

      persistState("s4", makeState("s4", 222))
      await setTimeoutPromise(10)
      const secondMeta = JSON.parse(readFileSync(metaPath, "utf-8")) as { createdAt: number; lastUpdated: number }

      expect(secondMeta.createdAt).toBe(firstMeta.createdAt)
      expect(secondMeta.lastUpdated).toBeGreaterThanOrEqual(firstMeta.lastUpdated)
    })
  })
})
