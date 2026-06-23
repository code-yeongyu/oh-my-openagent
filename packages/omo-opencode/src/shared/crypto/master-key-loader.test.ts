/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MasterKeyInsecureModeError,
  _resetDevFallbackWarningsForTests,
  loadMasterKey,
} from "./master-key-loader"

const ENV_NAME = "IDM_ACCOUNT_FLEET_MASTER_KEY_V1"
const HEX_KEY = "a".repeat(64)
const OTHER_HEX_KEY = "b".repeat(64)
const FILE_HEX_KEY = "c".repeat(64)

let warnSpy: ReturnType<typeof spyOn>
let originalEnv: string | undefined
let configDir: string

beforeEach(() => {
  originalEnv = process.env[ENV_NAME]
  delete process.env[ENV_NAME]
  _resetDevFallbackWarningsForTests()
  warnSpy = spyOn(console, "warn").mockImplementation(() => {})
  configDir = mkdtempSync(join(tmpdir(), "idm-master-key-loader-"))
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_NAME]
  else process.env[ENV_NAME] = originalEnv
  warnSpy.mockRestore()
  try {
    rmSync(configDir, { recursive: true, force: true })
  } catch {
    void 0
  }
})

function writeKeyFile(name: string, content: string, mode = 0o600): string {
  const path = join(configDir, name)
  writeFileSync(path, content)
  chmodSync(path, mode)
  return path
}

describe("loadMasterKey", () => {
  describe("#given env IDM_ACCOUNT_FLEET_MASTER_KEY_V1 is a valid 64-char hex", () => {
    describe("#when loadMasterKey('v1') is called", () => {
      it("should return a 32-byte buffer matching env hex", () => {
        process.env[ENV_NAME] = HEX_KEY
        const key = loadMasterKey("v1")
        expect(key.length).toBe(32)
        expect(key.equals(Buffer.from(HEX_KEY, "hex"))).toBe(true)
      })

      it("should not emit a dev fallback warning even when fallback opts provided", () => {
        process.env[ENV_NAME] = HEX_KEY
        loadMasterKey("v1", { dbPath: "/tmp/some.db", allowDevFallback: true })
        expect(warnSpy).not.toHaveBeenCalled()
      })

      it("should win over dbPath + allowDevFallback (production trumps fallback)", () => {
        process.env[ENV_NAME] = OTHER_HEX_KEY
        const key = loadMasterKey("v1", { dbPath: "/tmp/x.db", allowDevFallback: true })
        expect(key.equals(Buffer.from(OTHER_HEX_KEY, "hex"))).toBe(true)
      })

      it("should win over the file fallback (env trumps file even when file is valid)", () => {
        process.env[ENV_NAME] = OTHER_HEX_KEY
        writeKeyFile("master-key-v1", FILE_HEX_KEY)
        const key = loadMasterKey("v1", { configDir })
        expect(key.equals(Buffer.from(OTHER_HEX_KEY, "hex"))).toBe(true)
      })
    })
  })

  describe("#given env is unset and dev fallback is opted in", () => {
    describe("#when loadMasterKey is called twice with same dbPath", () => {
      it("should derive a stable 32-byte key and warn exactly once", () => {
        const opts = { dbPath: "/tmp/account-fleet.db", allowDevFallback: true }
        const a = loadMasterKey("v1", opts)
        const b = loadMasterKey("v1", opts)
        expect(a.length).toBe(32)
        expect(a.equals(b)).toBe(true)
        expect(warnSpy).toHaveBeenCalledTimes(1)
      })

      it("should warn again for a different dbPath", () => {
        loadMasterKey("v1", { dbPath: "/tmp/path-a.db", allowDevFallback: true })
        loadMasterKey("v1", { dbPath: "/tmp/path-b.db", allowDevFallback: true })
        expect(warnSpy).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe("#given env is unset and allowDevFallback is missing or false", () => {
    describe("#when loadMasterKey is called", () => {
      it("should throw master_key_unavailable when no options at all", () => {
        expect(() => loadMasterKey("v1")).toThrow(/master_key_unavailable/)
      })

      it("should throw master_key_unavailable when dbPath provided but allowDevFallback omitted", () => {
        expect(() => loadMasterKey("v1", { dbPath: "/tmp/x.db" })).toThrow(
          /master_key_unavailable/,
        )
      })

      it("should throw master_key_unavailable when allowDevFallback=true but dbPath missing", () => {
        expect(() => loadMasterKey("v1", { allowDevFallback: true })).toThrow(
          /master_key_unavailable/,
        )
      })
    })
  })

  describe("#given env IS SET but invalid (production fail-fast wins over fallback)", () => {
    describe("#when loadMasterKey is called", () => {
      it("should throw master_key_invalid for non-hex value", () => {
        process.env[ENV_NAME] = "not-hex-zzzzzzzzzz"
        expect(() => loadMasterKey("v1")).toThrow(/master_key_invalid/)
      })

      it("should throw master_key_invalid for wrong-length hex even with fallback opts", () => {
        process.env[ENV_NAME] = "deadbeef"
        expect(() =>
          loadMasterKey("v1", { dbPath: "/tmp/x.db", allowDevFallback: true }),
        ).toThrow(/master_key_invalid/)
      })

      it("should throw master_key_invalid for empty/whitespace-only env", () => {
        process.env[ENV_NAME] = "   "
        expect(() =>
          loadMasterKey("v1", { dbPath: "/tmp/x.db", allowDevFallback: true }),
        ).toThrow(/master_key_invalid/)
      })
    })
  })

  describe("#given env is unset and a file fallback is present", () => {
    describe("#when the file is mode 0600 with a valid 64-hex content", () => {
      it("should return a 32-byte buffer matching the file hex content", () => {
        writeKeyFile("master-key-v1", FILE_HEX_KEY)
        const key = loadMasterKey("v1", { configDir })
        expect(key.length).toBe(32)
        expect(key.equals(Buffer.from(FILE_HEX_KEY, "hex"))).toBe(true)
      })

      it("should trim surrounding whitespace before hex validation", () => {
        writeKeyFile("master-key-v1", `   ${FILE_HEX_KEY}\n`)
        const key = loadMasterKey("v1", { configDir })
        expect(key.equals(Buffer.from(FILE_HEX_KEY, "hex"))).toBe(true)
      })

      it("should beat the dev fallback when allowDevFallback=true && dbPath set", () => {
        writeKeyFile("master-key-v1", FILE_HEX_KEY)
        const key = loadMasterKey("v1", {
          configDir,
          dbPath: "/tmp/should-not-be-used.db",
          allowDevFallback: true,
        })
        expect(key.equals(Buffer.from(FILE_HEX_KEY, "hex"))).toBe(true)
        expect(warnSpy).not.toHaveBeenCalled()
      })
    })

    describe("#when the file has group/other-readable bits set", () => {
      it("should throw MasterKeyInsecureModeError with code INSECURE_MODE for mode 0644", () => {
        const path = writeKeyFile("master-key-v1", FILE_HEX_KEY, 0o644)
        let thrown: unknown
        try {
          loadMasterKey("v1", { configDir })
        } catch (e) {
          thrown = e
        }
        expect(thrown).toBeInstanceOf(MasterKeyInsecureModeError)
        const err = thrown as MasterKeyInsecureModeError
        expect(err.code).toBe("INSECURE_MODE")
        expect(err.path).toBe(path)
        expect(err.message).toContain("chmod 600")
        expect(err.message).toContain(path)
      })

      it("should throw MasterKeyInsecureModeError for mode 0640 (group-readable)", () => {
        writeKeyFile("master-key-v1", FILE_HEX_KEY, 0o640)
        expect(() => loadMasterKey("v1", { configDir })).toThrow(MasterKeyInsecureModeError)
      })

      it("should accept mode 0400 (read-only owner)", () => {
        writeKeyFile("master-key-v1", FILE_HEX_KEY, 0o400)
        const key = loadMasterKey("v1", { configDir })
        expect(key.equals(Buffer.from(FILE_HEX_KEY, "hex"))).toBe(true)
      })
    })

    describe("#when the file has non-hex content", () => {
      it("should throw master_key_invalid", () => {
        writeKeyFile("master-key-v1", "not-hex-zzzzzzzzzzzzzz")
        expect(() => loadMasterKey("v1", { configDir })).toThrow(/master_key_invalid/)
      })

      it("should throw master_key_invalid for wrong-length hex", () => {
        writeKeyFile("master-key-v1", "deadbeef")
        expect(() => loadMasterKey("v1", { configDir })).toThrow(/master_key_invalid/)
      })
    })
  })

  describe("#given env unset, no file, and dev fallback disabled", () => {
    describe("#when loadMasterKey runs with a valid configDir but no file", () => {
      it("should throw master_key_unavailable", () => {
        expect(() => loadMasterKey("v1", { configDir })).toThrow(/master_key_unavailable/)
      })
    })
  })
})
