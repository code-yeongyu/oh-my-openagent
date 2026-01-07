import { describe, it, expect } from "bun:test"
import { isProviderAvailable, createProvider } from "./index"
import type {
  ExternalCliExecuteOptions,
  ExternalCliExecuteResult,
  ExternalCliProviderInterface,
  CursorAgentResponse,
} from "./types"

describe("external-cli executor", () => {
  describe("types", () => {
    // #given CursorAgentResponse type
    // #when creating a valid response object
    // #then it should match the expected structure
    it("CursorAgentResponse should have correct structure", () => {
      const response: CursorAgentResponse = {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1000,
        duration_api_ms: 900,
        result: "test output",
        session_id: "test-session",
        request_id: "test-request",
      }

      expect(response.type).toBe("result")
      expect(response.is_error).toBe(false)
      expect(response.result).toBe("test output")
    })

    // #given ExternalCliExecuteOptions type
    // #when creating valid options
    // #then it should accept all required and optional fields
    it("ExternalCliExecuteOptions should have required fields", () => {
      const options: ExternalCliExecuteOptions = {
        model: "gpt-5.1-codex",
        prompt: "test prompt",
      }

      expect(options.model).toBe("gpt-5.1-codex")
      expect(options.prompt).toBe("test prompt")
      expect(options.workspace).toBeUndefined()
      expect(options.timeout).toBeUndefined()
    })

    // #given ExternalCliExecuteResult type
    // #when creating success and error results
    // #then both should be valid
    it("ExternalCliExecuteResult should handle success and error", () => {
      const successResult: ExternalCliExecuteResult = {
        success: true,
        result: "output",
        duration_ms: 1000,
        session_id: "sess-123",
      }

      const errorResult: ExternalCliExecuteResult = {
        success: false,
        result: "",
        error: "Something went wrong",
      }

      expect(successResult.success).toBe(true)
      expect(errorResult.success).toBe(false)
      expect(errorResult.error).toBe("Something went wrong")
    })
  })

  describe("provider factory", () => {
    // #given cursor provider name
    // #when creating provider
    // #then it should return a valid provider instance
    it("creates cursor provider", () => {
      const provider = createProvider("cursor")
      expect(provider).toBeDefined()
      expect(provider.name).toBe("cursor")
    })

    // #given a provider interface
    // #when checking its methods
    // #then it should have execute and isAvailable
    it("provider has required interface methods", () => {
      const provider: ExternalCliProviderInterface = createProvider("cursor")
      expect(typeof provider.execute).toBe("function")
      expect(typeof provider.isAvailable).toBe("function")
      expect(provider.name).toBe("cursor")
    })
  })

  describe("isProviderAvailable", () => {
    // #given cursor provider
    // #when checking availability
    // #then it should return boolean without throwing
    it("returns boolean without throwing", async () => {
      const result = await isProviderAvailable("cursor")
      expect(typeof result).toBe("boolean")
    })
  })
})
