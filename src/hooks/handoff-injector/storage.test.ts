import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  handoffFileExists,
  readHandoffFile,
  archiveHandoffFile,
  getHandoffFilePath,
  getHandoffConsumedFilePath,
} from "./storage"

describe("handoff-injector/storage", () => {
  const TEST_DIR = join(tmpdir(), "handoff-storage-test-" + Date.now())
  const MATRIX_DIR = join(TEST_DIR, ".matrix")

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    if (!existsSync(MATRIX_DIR)) {
      mkdirSync(MATRIX_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("getHandoffFilePath", () => {
    test("returns path to .matrix/handoff.md", () => {
      //#given - a directory path
      const dir = "/some/project"

      //#when
      const result = getHandoffFilePath(dir)

      //#then
      expect(result).toBe("/some/project/.matrix/handoff.md")
    })
  })

  describe("getHandoffConsumedFilePath", () => {
    test("returns path to .matrix/handoff.consumed.md", () => {
      //#given - a directory path
      const dir = "/some/project"

      //#when
      const result = getHandoffConsumedFilePath(dir)

      //#then
      expect(result).toBe("/some/project/.matrix/handoff.consumed.md")
    })
  })

  describe("handoffFileExists", () => {
    test("returns true when .matrix/handoff.md exists", () => {
      //#given - handoff.md exists
      const handoffPath = join(MATRIX_DIR, "handoff.md")
      writeFileSync(handoffPath, "some content")

      //#when
      const result = handoffFileExists(TEST_DIR)

      //#then
      expect(result).toBe(true)
    })

    test("returns false when file does not exist", () => {
      //#given - .matrix dir exists but no handoff.md

      //#when
      const result = handoffFileExists(TEST_DIR)

      //#then
      expect(result).toBe(false)
    })

    test("returns false when .matrix/ dir does not exist", () => {
      //#given - a directory with no .matrix subdirectory
      const emptyDir = join(tmpdir(), "handoff-empty-" + Date.now())
      mkdirSync(emptyDir, { recursive: true })

      //#when
      const result = handoffFileExists(emptyDir)

      //#then
      expect(result).toBe(false)

      rmSync(emptyDir, { recursive: true, force: true })
    })
  })

  describe("readHandoffFile", () => {
    test("returns file content when file exists", () => {
      //#given - handoff.md with content
      const content = "HANDOFF CONTEXT\n===============\nsome context here"
      writeFileSync(join(MATRIX_DIR, "handoff.md"), content)

      //#when
      const result = readHandoffFile(TEST_DIR)

      //#then
      expect(result).toBe(content)
    })

    test("returns empty string when file is empty", () => {
      //#given - handoff.md with empty content
      writeFileSync(join(MATRIX_DIR, "handoff.md"), "")

      //#when
      const result = readHandoffFile(TEST_DIR)

      //#then
      expect(result).toBe("")
    })

    test("returns null when file does not exist", () => {
      //#given - no handoff.md file

      //#when
      const result = readHandoffFile(TEST_DIR)

      //#then
      expect(result).toBeNull()
    })

    test("returns null when .matrix/ dir does not exist", () => {
      //#given - a directory with no .matrix subdirectory
      const emptyDir = join(tmpdir(), "handoff-nodir-" + Date.now())
      mkdirSync(emptyDir, { recursive: true })

      //#when
      const result = readHandoffFile(emptyDir)

      //#then
      expect(result).toBeNull()

      rmSync(emptyDir, { recursive: true, force: true })
    })
  })

  describe("archiveHandoffFile", () => {
    test("renames handoff.md to handoff.consumed.md and returns true", () => {
      //#given - handoff.md exists with content
      const content = "handoff content"
      writeFileSync(join(MATRIX_DIR, "handoff.md"), content)

      //#when
      const result = archiveHandoffFile(TEST_DIR)

      //#then
      expect(result).toBe(true)
      expect(existsSync(join(MATRIX_DIR, "handoff.md"))).toBe(false)
      expect(existsSync(join(MATRIX_DIR, "handoff.consumed.md"))).toBe(true)
      expect(readFileSync(join(MATRIX_DIR, "handoff.consumed.md"), "utf-8")).toBe(content)
    })

    test("returns false when handoff.md does not exist", () => {
      //#given - no handoff.md file

      //#when
      const result = archiveHandoffFile(TEST_DIR)

      //#then
      expect(result).toBe(false)
    })

    test("overwrites existing handoff.consumed.md", () => {
      //#given - both handoff.md and handoff.consumed.md exist
      writeFileSync(join(MATRIX_DIR, "handoff.consumed.md"), "old content")
      writeFileSync(join(MATRIX_DIR, "handoff.md"), "new content")

      //#when
      const result = archiveHandoffFile(TEST_DIR)

      //#then
      expect(result).toBe(true)
      expect(existsSync(join(MATRIX_DIR, "handoff.md"))).toBe(false)
      expect(readFileSync(join(MATRIX_DIR, "handoff.consumed.md"), "utf-8")).toBe("new content")
    })
  })
})
