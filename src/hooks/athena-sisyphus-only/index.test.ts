/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { isAllowedPath } from "./path-policy"
import { isAthenaAgent } from "./agent-matcher"
const WORKSPACE_ROOT = "/fake/workspace"

describe("athena-sisyphus-only hook", () => {
  describe("#given the path policy", () => {
    describe("#when checking allowed paths", () => {
      it("#then allows .sisyphus/file.md", () => {
        expect(isAllowedPath(".sisyphus/file.md", WORKSPACE_ROOT)).toBe(true)
      })

      it("#then allows nested .sisyphus/sub/dir/file.yaml", () => {
        expect(isAllowedPath(".sisyphus/sub/dir/file.yaml", WORKSPACE_ROOT)).toBe(true)
      })

      it("#then allows any extension inside .sisyphus/", () => {
        expect(isAllowedPath(".sisyphus/file.json", WORKSPACE_ROOT)).toBe(true)
      })

      it("#then allows deep nesting .sisyphus/notepads/plan/learnings.md", () => {
        expect(isAllowedPath(".sisyphus/notepads/plan/learnings.md", WORKSPACE_ROOT)).toBe(true)
      })
    })

    describe("#when checking blocked paths", () => {
      it("#then blocks src/agents/athena/agent.ts (outside .sisyphus/)", () => {
        expect(isAllowedPath("src/agents/athena/agent.ts", WORKSPACE_ROOT)).toBe(false)
      })

      it("#then blocks docs/planning/synthesis.md (outside .sisyphus/)", () => {
        expect(isAllowedPath("docs/planning/synthesis.md", WORKSPACE_ROOT)).toBe(false)
      })

      it("#then blocks root-level package.json", () => {
        expect(isAllowedPath("package.json", WORKSPACE_ROOT)).toBe(false)
      })

      it("#then blocks absolute path outside project", () => {
        expect(isAllowedPath("/etc/passwd", WORKSPACE_ROOT)).toBe(false)
      })
    })

    describe("#when checking path traversal attacks", () => {
      it("#then blocks .sisyphus/../package.json (single traversal)", () => {
        expect(isAllowedPath(".sisyphus/../package.json", WORKSPACE_ROOT)).toBe(false)
      })

      it("#then blocks .sisyphus/../../etc/passwd (double traversal)", () => {
        expect(isAllowedPath(".sisyphus/../../etc/passwd", WORKSPACE_ROOT)).toBe(false)
      })
    })

    describe("#when checking edge cases", () => {
      it("#then blocks empty string path", () => {
        expect(isAllowedPath("", WORKSPACE_ROOT)).toBe(false)
      })

      it("#then blocks file named sisyphus without dot prefix", () => {
        expect(isAllowedPath("sisyphus/file.md", WORKSPACE_ROOT)).toBe(false)
      })

      it("#then allows absolute path within .sisyphus/", () => {
        const absPath = `${WORKSPACE_ROOT}/.sisyphus/plans/test.md`
        expect(isAllowedPath(absPath, WORKSPACE_ROOT)).toBe(true)
      })

      it("#then allows .sisyphus/plans/foo.md when .sisyphus doesn't exist yet (bootstrap)", () => {
        expect(isAllowedPath(".sisyphus/plans/foo.md", WORKSPACE_ROOT)).toBe(true)
      })

      it("#then blocks ../etc/passwd even when .sisyphus doesn't exist", () => {
        expect(isAllowedPath("../etc/passwd", WORKSPACE_ROOT)).toBe(false)
      })

      it("#then blocks ../../etc/passwd path traversal", () => {
        expect(isAllowedPath("../../etc/passwd", WORKSPACE_ROOT)).toBe(false)
      })
    })

    describe("#when checking symlink rejection", () => {
      let tempWorkspaceRoot: string

      beforeEach(async () => {
        tempWorkspaceRoot = await mkdtemp(join(tmpdir(), "athena-sisyphus-only-"))
        await mkdir(join(tempWorkspaceRoot, ".sisyphus", "tmp"), { recursive: true })
        await mkdir(join(tempWorkspaceRoot, "outside", "nested"), { recursive: true })
      })

      afterEach(async () => {
        await rm(tempWorkspaceRoot, { recursive: true, force: true })
      })

      it("#then rejects symlink inside .sisyphus/tmp/ pointing outside workspace", async () => {
        const outsideFile = join(tempWorkspaceRoot, "outside", "secret.md")
        const symlinkPath = join(tempWorkspaceRoot, ".sisyphus", "tmp", "escape.md")

        await writeFile(outsideFile, "secret", "utf-8")
        await symlink(outsideFile, symlinkPath)

        expect(isAllowedPath(symlinkPath, tempWorkspaceRoot)).toBe(false)
      })

      it("#then rejects symlink inside .sisyphus/ pointing to file outside workspace", async () => {
        const outsideTarget = join(tmpdir(), "athena-outside-target.txt")
        const symlinkPath = join(tempWorkspaceRoot, ".sisyphus", "outside-link")

        await writeFile(outsideTarget, "outside-content", "utf-8")
        try {
          await symlink(outsideTarget, symlinkPath)

          expect(isAllowedPath(symlinkPath, tempWorkspaceRoot)).toBe(false)
        } finally {
          await rm(outsideTarget, { force: true })
        }
      })

      it("#then allows a regular file inside .sisyphus/tmp/", async () => {
        const regularFile = join(tempWorkspaceRoot, ".sisyphus", "tmp", "prompt.md")

        await writeFile(regularFile, "prompt", "utf-8")

        expect(isAllowedPath(regularFile, tempWorkspaceRoot)).toBe(true)
      })

      it("#then rejects a path with .. traversal", () => {
        expect(isAllowedPath(".sisyphus/tmp/../../outside/secret.md", tempWorkspaceRoot)).toBe(false)
      })

      it("#then rejects nested symlinks that escape workspace", async () => {
        const outsideNestedDir = join(tempWorkspaceRoot, "outside", "nested")
        const nestedFile = join(outsideNestedDir, "secret.md")
        const linkedDir = join(tempWorkspaceRoot, ".sisyphus", "tmp", "linked-dir")

        await writeFile(nestedFile, "secret", "utf-8")
        await symlink(outsideNestedDir, linkedDir)

        expect(isAllowedPath(join(linkedDir, "secret.md"), tempWorkspaceRoot)).toBe(false)
      })
    })
  })

  describe("#given the agent matcher", () => {
    describe("#when checking Athena agent", () => {
      it("#then matches exact 'athena'", () => {
        expect(isAthenaAgent("athena")).toBe(true)
      })

      it("#then matches case-insensitive 'Athena'", () => {
        expect(isAthenaAgent("Athena")).toBe(true)
      })

      it("#then matches 'ATHENA' (all caps)", () => {
        expect(isAthenaAgent("ATHENA")).toBe(true)
      })
    })

    describe("#when checking non-Athena agents", () => {
      it("#then rejects undefined", () => {
        expect(isAthenaAgent(undefined)).toBe(false)
      })

      it("#then rejects 'sisyphus'", () => {
        expect(isAthenaAgent("sisyphus")).toBe(false)
      })

      it("#then rejects 'council-member'", () => {
        expect(isAthenaAgent("council-member")).toBe(false)
      })

      it("#then rejects empty string", () => {
        expect(isAthenaAgent("")).toBe(false)
      })
    })
  })
})
