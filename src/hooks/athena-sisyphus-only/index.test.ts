import { describe, expect, it } from "bun:test"
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
