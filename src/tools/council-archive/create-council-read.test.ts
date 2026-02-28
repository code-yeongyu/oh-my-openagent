/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCouncilRead } from "./create-council-read"

let tempDir: string
let sisyphusDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "council-read-test-"))
  sisyphusDir = join(tempDir, ".sisyphus")
  await mkdir(sisyphusDir, { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const toolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

describe("createCouncilRead", () => {
  describe("#given an archive file with clean extracted content", () => {
    it("#then returns has_response true, response_complete true, and raw file content", async () => {
      const archivePath = join(sisyphusDir, "member-1.txt")
      await writeFile(archivePath, "Full analysis here")

      const tool = createCouncilRead(tempDir)
      const relativePath = `.sisyphus/member-1.txt`

      const result = await tool.execute({ file_path: relativePath }, toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.has_response).toBe(true)
      expect(parsed.response_complete).toBe(true)
      expect(parsed.result).toBe("Full analysis here")
    })
  })

  describe("#given an archive file containing tag-like text", () => {
    it("#then returns raw content without re-parsing tags", async () => {
      const archivePath = join(sisyphusDir, "member-2.txt")
      await writeFile(archivePath, "<COUNCIL_MEMBER_RESPONSE>do not parse this</COUNCIL_MEMBER_RESPONSE>")

      const tool = createCouncilRead(tempDir)
      const relativePath = `.sisyphus/member-2.txt`

      const result = await tool.execute({ file_path: relativePath }, toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.has_response).toBe(true)
      expect(parsed.response_complete).toBe(true)
      expect(parsed.result).toBe("<COUNCIL_MEMBER_RESPONSE>do not parse this</COUNCIL_MEMBER_RESPONSE>")
    })
  })

  describe("#given an archive file with empty content", () => {
    it("#then returns empty result content", async () => {
      const archivePath = join(sisyphusDir, "member-3.txt")
      await writeFile(archivePath, "")

      const tool = createCouncilRead(tempDir)
      const relativePath = `.sisyphus/member-3.txt`

      const result = await tool.execute({ file_path: relativePath }, toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.has_response).toBe(true)
      expect(parsed.response_complete).toBe(true)
      expect(parsed.result).toBe("")
    })
  })

  describe("#given a path outside .sisyphus/", () => {
    it("#then returns Access denied error", async () => {
      const tool = createCouncilRead(tempDir)
      const result = await tool.execute({ file_path: "/etc/passwd" }, toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.error).toBe("Access denied: path must be within .sisyphus/")
    })
  })

  describe("#given a missing file within .sisyphus/", () => {
    it("#then returns has_response false with File not found error", async () => {
      const tool = createCouncilRead(tempDir)
      const relativePath = `.sisyphus/nonexistent-file.txt`

      const result = await tool.execute({ file_path: relativePath }, toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.has_response).toBe(false)
      expect(parsed.error).toContain("File not found")
      expect(parsed.error).toContain(relativePath)
    })
  })

  describe("#given a path traversal attempt", () => {
    it("#then returns Access denied error", async () => {
      const tool = createCouncilRead(tempDir)
      const result = await tool.execute({ file_path: "../../../etc/passwd" }, toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.error).toBe("Access denied: path must be within .sisyphus/")
    })
  })

  describe("#given a Windows-style path under .sisyphus", () => {
    it("#then normalizes separators and reads the file successfully", async () => {
      const archivePath = join(sisyphusDir, "windows-path.txt")
      await writeFile(archivePath, "Windows path response")

      const tool = createCouncilRead(tempDir)
      const result = await tool.execute({ file_path: ".sisyphus\\windows-path.txt" }, toolContext)
      const parsed = JSON.parse(result)

      expect(parsed.has_response).toBe(true)
      expect(parsed.response_complete).toBe(true)
      expect(parsed.result).toBe("Windows path response")
    })
  })
})
