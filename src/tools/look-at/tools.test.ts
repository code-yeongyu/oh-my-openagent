import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { normalizeArgs, validateArgs, createLookAt } from "./tools"

describe("look-at tool", () => {
  describe("normalizeArgs", () => {
    // given LLM might use `path` instead of `file_path`
    // when called with path parameter
    // then should normalize to file_path
    test("normalizes path to file_path for LLM compatibility", () => {
      const args = { path: "/some/file.png", goal: "analyze" }
      const normalized = normalizeArgs(args as any)
      expect(normalized.file_path).toBe("/some/file.png")
      expect(normalized.goal).toBe("analyze")
    })

    // given proper file_path usage
    // when called with file_path parameter
    // then keep as-is
    test("keeps file_path when properly provided", () => {
      const args = { file_path: "/correct/path.pdf", goal: "extract" }
      const normalized = normalizeArgs(args)
      expect(normalized.file_path).toBe("/correct/path.pdf")
    })

    // given both parameters provided
    // when file_path and path are both present
    // then prefer file_path
    test("prefers file_path over path when both provided", () => {
      const args = { file_path: "/preferred.png", path: "/fallback.png", goal: "test" }
      const normalized = normalizeArgs(args as any)
      expect(normalized.file_path).toBe("/preferred.png")
    })
  })

  describe("validateArgs", () => {
    // given valid arguments
    // when validated
    // then return null (no error)
    test("returns null for valid args", () => {
      const args = { file_path: "/valid/path.png", goal: "analyze" }
      expect(validateArgs(args)).toBeNull()
    })

    // given file_path missing
    // when validated
    // then clear error message
    test("returns error when file_path is missing", () => {
      const args = { goal: "analyze" } as any
      const error = validateArgs(args)
      expect(error).toContain("file_path")
      expect(error).toContain("required")
    })

    // given goal missing
    // when validated
    // then clear error message
    test("returns error when goal is missing", () => {
      const args = { file_path: "/some/path.png" } as any
      const error = validateArgs(args)
      expect(error).toContain("goal")
      expect(error).toContain("required")
    })

    // given file_path is empty string
    // when validated
    // then return error
    test("returns error when file_path is empty string", () => {
      const args = { file_path: "", goal: "analyze" }
      const error = validateArgs(args)
      expect(error).toContain("file_path")
    })
  })

  describe("createLookAt error handling", () => {
    // given JSON parse error occurs in session.prompt
    // when LookAt tool executed
    // then return user-friendly error message
    test("handles JSON parse error from session.prompt gracefully", async () => {
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_test_json_error" } }),
          prompt: async () => {
            throw new Error("JSON Parse error: Unexpected EOF")
          },
          messages: async () => ({ data: [] }),
        },
      }

      const tool = createLookAt({
        client: mockClient,
        directory: "/project",
      } as any)

      const toolContext: ToolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        directory: "/project",
        worktree: "/project",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }

      const result = await tool.execute(
        { file_path: "/test/file.png", goal: "analyze image" },
        toolContext
      )

      expect(result).toContain("Error: Failed to analyze file")
      expect(result).toContain("malformed response")
      expect(result).toContain("multimodal-looker")
      expect(result).toContain("image/png")
    })

    // given generic error occurs in session.prompt
    // when LookAt tool executed
    // then return error including original error message
    test("handles generic prompt error gracefully", async () => {
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_test_generic_error" } }),
          prompt: async () => {
            throw new Error("Network connection failed")
          },
          messages: async () => ({ data: [] }),
        },
      }

      const tool = createLookAt({
        client: mockClient,
        directory: "/project",
      } as any)

      const toolContext: ToolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        directory: "/project",
        worktree: "/project",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }

      const result = await tool.execute(
        { file_path: "/test/file.pdf", goal: "extract text" },
        toolContext
      )

      expect(result).toContain("Error: Failed to send prompt")
      expect(result).toContain("Network connection failed")
    })
  })

  describe("createLookAt model passthrough", () => {
    // given multimodal-looker agent has resolved model info
    // when LookAt tool executed
    // then model info should be passed to session.prompt
    test("passes multimodal-looker model to session.prompt when available", async () => {
      let promptBody: any

      const mockClient = {
        app: {
          agents: async () => ({
            data: [
              {
                name: "multimodal-looker",
                mode: "subagent",
                model: { providerID: "google", modelID: "gemini-3-flash" },
              },
            ],
          }),
        },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_model_passthrough" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [
              { info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "done" }] },
            ],
          }),
        },
      }

      const tool = createLookAt({
        client: mockClient,
        directory: "/project",
      } as any)

      const toolContext: ToolContext = {
        sessionID: "parent-session",
        messageID: "parent-message",
        agent: "sisyphus",
        directory: "/project",
        worktree: "/project",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }

      await tool.execute(
        { file_path: "/test/file.png", goal: "analyze image" },
        toolContext
      )

      expect(promptBody.model).toEqual({
        providerID: "google",
        modelID: "gemini-3-flash",
      })
    })
  })
})
