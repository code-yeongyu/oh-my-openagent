import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { createPrContextInjectorHook } from "./index"
import * as childProcess from "node:child_process"

describe("createPrContextInjectorHook", () => {
  let execSyncMock: ReturnType<typeof mock>

  beforeEach(() => {
    execSyncMock = spyOn(childProcess, "execSync")
  })

  //#given a feature branch with diff
  describe("when on a feature branch with changes", () => {
    beforeEach(() => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          return "feature/my-feature\n"
        }
        if (cmd === "git rev-parse --verify main") {
          return "abc123\n"
        }
        if (cmd.startsWith("git diff main...HEAD --stat")) {
          return " src/index.ts | 10 +++++++---\n src/utils.ts | 5 +++++\n 2 files changed, 12 insertions(+), 3 deletions(-)\n"
        }
        return ""
      })
    })

    //#when chat.message is called
    //#then context should include branch name and diff summary
    it("should inject PR context with branch name and diff summary", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-1" }
      const output: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output)

      expect(output.parts).toBeDefined()
      expect(output.parts?.length).toBe(1)
      expect(output.parts?.[0].type).toBe("text")
      expect(output.parts?.[0].text).toContain("[PR CONTEXT]")
      expect(output.parts?.[0].text).toContain("Branch: feature/my-feature")
      expect(output.parts?.[0].text).toContain("src/index.ts")
      expect(output.parts?.[0].text).toContain("2 files changed")
    })

    //#given same session called twice
    //#then hook should only inject once (track sessionID)
    it("should only inject once per session", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-2" }
      const output1: { parts?: Array<{ type: string; text?: string }> } = {}
      const output2: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output1)
      await hook["chat.message"](input, output2)

      expect(output1.parts?.length).toBe(1)
      expect(output2.parts).toBeUndefined()
    })
  })

  //#given main branch
  describe("when on main branch", () => {
    beforeEach(() => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          return "main\n"
        }
        return ""
      })
    })

    //#when chat.message is called
    //#then hook should NOT inject anything
    it("should not inject anything", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-3" }
      const output: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output)

      expect(output.parts).toBeUndefined()
    })
  })

  //#given master branch
  describe("when on master branch", () => {
    beforeEach(() => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          return "master\n"
        }
        return ""
      })
    })

    //#when chat.message is called
    //#then hook should NOT inject anything
    it("should not inject anything", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-4" }
      const output: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output)

      expect(output.parts).toBeUndefined()
    })
  })

  //#given dev branch
  describe("when on dev branch", () => {
    beforeEach(() => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          return "dev\n"
        }
        return ""
      })
    })

    //#when chat.message is called
    //#then hook should NOT inject anything
    it("should not inject anything", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-5" }
      const output: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output)

      expect(output.parts).toBeUndefined()
    })
  })

  //#given git command fails
  describe("when git command fails", () => {
    beforeEach(() => {
      execSyncMock.mockImplementation(() => {
        throw new Error("git not available")
      })
    })

    //#when chat.message is called
    //#then hook should handle error gracefully and not inject
    it("should handle error gracefully and not inject", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-6" }
      const output: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output)

      expect(output.parts).toBeUndefined()
    })
  })

  //#given feature branch with no diff
  describe("when on feature branch with no diff", () => {
    beforeEach(() => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          return "feature/empty-branch\n"
        }
        if (cmd === "git rev-parse --verify main") {
          return "abc123\n"
        }
        if (cmd.startsWith("git diff main...HEAD --stat")) {
          return ""
        }
        return ""
      })
    })

    //#when chat.message is called
    //#then hook should NOT inject anything (no diff to show)
    it("should not inject anything when diff is empty", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-7" }
      const output: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output)

      expect(output.parts).toBeUndefined()
    })
  })

  //#given master as base when main doesn't exist
  describe("when main branch does not exist but master does", () => {
    beforeEach(() => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === "git branch --show-current") {
          return "feature/test-branch\n"
        }
        if (cmd === "git rev-parse --verify main") {
          throw new Error("fatal: Needed a single revision")
        }
        if (cmd === "git rev-parse --verify master") {
          return "def456\n"
        }
        if (cmd.startsWith("git diff master...HEAD --stat")) {
          return " README.md | 2 ++\n 1 file changed, 2 insertions(+)\n"
        }
        return ""
      })
    })

    //#when chat.message is called
    //#then hook should use master as base branch
    it("should use master as base branch", async () => {
      const hook = createPrContextInjectorHook({ directory: "/test/project" })
      const input = { sessionID: "session-8" }
      const output: { parts?: Array<{ type: string; text?: string }> } = {}

      await hook["chat.message"](input, output)

      expect(output.parts).toBeDefined()
      expect(output.parts?.[0].text).toContain("README.md")
    })
  })
})
