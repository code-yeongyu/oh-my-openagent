import { afterAll, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { preserveModuleMocksForTestFile, restoreModuleMocksForTestFile } from "../../testing/module-mock-lifecycle"

const TEST_STORAGE_ROOT = mkdtempSync(join(tmpdir(), "omo-message-directory-storage-"))
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")

mock.module("../../shared/opencode-storage-paths", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: join(TEST_STORAGE_ROOT, "part"),
  SESSION_STORAGE: join(TEST_STORAGE_ROOT, "session"),
}))
preserveModuleMocksForTestFile(import.meta.url)

const { getOrCreateMessageDir } = await import("./message-directory")

afterAll(() => {
  restoreModuleMocksForTestFile(import.meta.url)
  rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true })
})

describe("message directory boundaries", () => {
  it("accepts nested storage directories whose names start with two dots", () => {
    // given
    const nestedPath = join(TEST_MESSAGE_STORAGE, "..project", "ses_dotdot_prefix")
    mkdirSync(nestedPath, { recursive: true })

    // when
    const result = getOrCreateMessageDir("ses_dotdot_prefix")

    // then
    expect(result).toBe(nestedPath)
  })
})
