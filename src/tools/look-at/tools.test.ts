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

    // given image_data provided
    // when called with base64 image data
    // then preserve image_data in normalized args
    test("preserves image_data when provided", () => {
      const args = { image_data: "data:image/png;base64,iVBORw0KGgo=", goal: "analyze" }
      const normalized = normalizeArgs(args as any)
      expect(normalized.image_data).toBe("data:image/png;base64,iVBORw0KGgo=")
      expect(normalized.file_path).toBeUndefined()
    })
  })

  describe("validateArgs", () => {
    // given valid arguments with file_path
    // when validated
    // then return null (no error)
    test("returns null for valid args with file_path", () => {
      const args = { file_path: "/valid/path.png", goal: "analyze" }
      expect(validateArgs(args)).toBeNull()
    })

    // given valid arguments with image_data
    // when validated
    // then return null (no error)
    test("returns null for valid args with image_data", () => {
      const args = { image_data: "data:image/png;base64,iVBORw0KGgo=", goal: "analyze" }
      expect(validateArgs(args)).toBeNull()
    })

    // given neither file_path nor image_data
    // when validated
    // then clear error message
    test("returns error when neither file_path nor image_data provided", () => {
      const args = { goal: "analyze" } as any
      const error = validateArgs(args)
      expect(error).toContain("file_path")
      expect(error).toContain("image_data")
    })

    // given both file_path and image_data
    // when validated
    // then return error (mutually exclusive)
    test("returns error when both file_path and image_data provided", () => {
      const args = { file_path: "/path.png", image_data: "base64data", goal: "analyze" }
      const error = validateArgs(args)
      expect(error).toContain("only one")
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
      expect(error).toContain("image_data")
    })

    // given image_data is empty string
    // when validated
    // then return error
    test("returns error when image_data is empty string", () => {
      const args = { image_data: "", goal: "analyze" }
      const error = validateArgs(args)
      expect(error).toContain("file_path")
      expect(error).toContain("image_data")
    })
  })

  describe("createLookAt error handling", () => {
    // given JSON parse error occurs in session.promptAsync
    // when LookAt tool executed
    // then error propagates (band-aid removed since root cause fixed by promptAsync migration)
    test("propagates JSON parse error from session.promptAsync", async () => {
      const throwingMock = async () => {
        throw new Error("JSON Parse error: Unexpected EOF")
      }
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_test_json_error" } }),
          prompt: throwingMock,
          promptAsync: throwingMock,
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

      await expect(
        tool.execute({ file_path: "/test/file.png", goal: "analyze image" }, toolContext)
      ).rejects.toThrow("JSON Parse error: Unexpected EOF")
    })

    // given generic error occurs in session.promptAsync
    // when LookAt tool executed
    // then error propagates
    test("propagates generic prompt error", async () => {
      const throwingMock = async () => {
        throw new Error("Network connection failed")
      }
      const mockClient = {
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_test_generic_error" } }),
          prompt: throwingMock,
          promptAsync: throwingMock,
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

      await expect(
        tool.execute({ file_path: "/test/file.pdf", goal: "extract text" }, toolContext)
      ).rejects.toThrow("Network connection failed")
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
          promptAsync: async (input: any) => {
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

  describe("createLookAt with image_data", () => {
    // given base64 image data is provided
    // when LookAt tool executed
    // then should send data URL to session.prompt
    test("sends data URL when image_data provided", async () => {
      let promptBody: any

      const mockClient = {
        app: {
          agents: async () => ({ data: [] }),
        },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_image_data_test" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          promptAsync: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [
              { info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "analyzed" }] },
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
        { image_data: "data:image/png;base64,iVBORw0KGgo=", goal: "describe this image" },
        toolContext
      )

      const filePart = promptBody.parts.find((p: any) => p.type === "file")
      expect(filePart).toBeDefined()
      expect(filePart.url).toContain("data:image/png;base64")
      expect(filePart.mime).toBe("image/png")
      expect(filePart.filename).toContain("clipboard-image")
    })

    // given raw base64 without data URI prefix
    // when LookAt tool executed
    // then should detect mime type and create proper data URL
    test("handles raw base64 without data URI prefix", async () => {
      let promptBody: any

      const mockClient = {
        app: {
          agents: async () => ({ data: [] }),
        },
        session: {
          get: async () => ({ data: { directory: "/project" } }),
          create: async () => ({ data: { id: "ses_raw_base64_test" } }),
          prompt: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          promptAsync: async (input: any) => {
            promptBody = input.body
            return { data: {} }
          },
          messages: async () => ({
            data: [
              { info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "analyzed" }] },
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
        { image_data: "iVBORw0KGgo=", goal: "analyze" },
        toolContext
      )

      const filePart = promptBody.parts.find((p: any) => p.type === "file")
      expect(filePart).toBeDefined()
      expect(filePart.url).toContain("data:")
      expect(filePart.url).toContain("base64")
    })
  })
})
