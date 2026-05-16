import { describe, it, expect, mock, beforeEach } from "bun:test"

const realpathSyncMock = mock((p: string) => p)

mock.module("node:fs", () => ({
  realpathSync: realpathSyncMock,
}))

const { isAllowedFile } = await import("../path-policy")

describe("path-policy symlink resolution (repro)", () => {
  beforeEach(() => {
    realpathSyncMock.mockClear()
    realpathSyncMock.mockImplementation((p: string) => p)
  })

  describe("macOS /Volumes vs /Users mismatch", () => {
    it("should allow file when workspace uses /Volumes but realpath resolves to /Users", () => {
      const workspaceRoot = "/Volumes/nsk_intel_mac/project"
      const filePath = "/Volumes/nsk_intel_mac/project/.sisyphus/plans/my-plan.md"

      realpathSyncMock.mockImplementation((p: string) =>
        p.replace("/Volumes/nsk_intel_mac", "/Users/nsk_intel_mac"),
      )

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(true)
    })

    it("should allow relative file path with symlink resolution", () => {
      const workspaceRoot = "/Volumes/nsk_intel_mac/project"
      const filePath = ".sisyphus/plans/my-plan.md"

      realpathSyncMock.mockImplementation((p: string) =>
        p.replace("/Volumes/nsk_intel_mac", "/Users/nsk_intel_mac"),
      )

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(true)
    })

    it("should reject file outside workspace even after realpath resolution", () => {
      const workspaceRoot = "/Volumes/nsk_intel_mac/project"
      const filePath = "/Volumes/nsk_intel_mac/other-project/.sisyphus/plans/evil.md"

      realpathSyncMock.mockImplementation((p: string) =>
        p.replace("/Volumes/nsk_intel_mac", "/Users/nsk_intel_mac"),
      )

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(false)
    })
  })

  describe("resolveCanonical ancestor walk-up for new files", () => {
    it("should handle non-existent file by walking up to existing parent", () => {
      const workspaceRoot = "/Volumes/nsk_intel_mac/project"
      const filePath = "/Volumes/nsk_intel_mac/project/.sisyphus/plans/new-plan.md"

      realpathSyncMock.mockImplementation((p: string) => {
        if (p.includes("new-plan.md") || p.endsWith("/plans")) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        }
        return p.replace("/Volumes/nsk_intel_mac", "/Users/nsk_intel_mac")
      })

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(true)
    })

    it("should handle fully non-existent path gracefully", () => {
      const workspaceRoot = "/project"
      const filePath = "/project/.sisyphus/plans/test.md"

      realpathSyncMock.mockImplementation(() => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      })

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(true)
    })
  })

  describe("existing security checks preserved", () => {
    it("should still reject traversal attacks", () => {
      const workspaceRoot = "/Users/nsk_intel_mac/project"
      const filePath = "/Users/nsk_intel_mac/project/../../etc/passwd"

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(false)
    })

    it("should still reject non-.md extensions", () => {
      const workspaceRoot = "/Users/nsk_intel_mac/project"
      const filePath = "/Users/nsk_intel_mac/project/.sisyphus/plans/evil.sh"

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(false)
    })

    it("should still reject files outside .sisyphus", () => {
      const workspaceRoot = "/Users/nsk_intel_mac/project"
      const filePath = "/Users/nsk_intel_mac/project/src/index.md"

      expect(isAllowedFile(filePath, workspaceRoot)).toBe(false)
    })
  })
})
