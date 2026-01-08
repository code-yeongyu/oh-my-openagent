import { describe, it, expect } from "bun:test"
import { ANTIGRAVITY_SYSTEM_PROMPT } from "./constants"
import { injectSystemPrompt, wrapRequestBody } from "./request"

describe("injectSystemPrompt", () => {
  describe("basic injection", () => {
    it("should inject system prompt into empty request", () => {
      // #given
      const wrappedBody = {
        project: "test-project",
        model: "gemini-3-pro-preview",
        request: {} as Record<string, unknown>,
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then
      const req = wrappedBody.request as { systemInstruction?: { role: string; parts: Array<{ text: string }> } }
      expect(req).toHaveProperty("systemInstruction")
      expect(req.systemInstruction?.role).toBe("user")
      expect(req.systemInstruction?.parts).toBeDefined()
      expect(Array.isArray(req.systemInstruction?.parts)).toBe(true)
      expect(req.systemInstruction?.parts?.length).toBe(1)
      expect(req.systemInstruction?.parts?.[0]?.text).toContain("<identity>")
    })

    it("should inject system prompt with correct structure", () => {
      // #given
      const wrappedBody = {
        project: "test-project",
        model: "gemini-3-pro-preview",
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        } as Record<string, unknown>,
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then
      const req = wrappedBody.request as { systemInstruction?: { role: string; parts: Array<{ text: string }> } }
      expect(req.systemInstruction).toEqual({
        role: "user",
        parts: [{ text: ANTIGRAVITY_SYSTEM_PROMPT }],
      })
    })
  })

  describe("prepend to existing systemInstruction", () => {
    it("should prepend Antigravity prompt before existing systemInstruction parts", () => {
      // #given
      const wrappedBody = {
        project: "test-project",
        model: "gemini-3-pro-preview",
        request: {
          systemInstruction: {
            role: "user",
            parts: [{ text: "existing system prompt" }],
          },
        } as Record<string, unknown>,
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then
      const req = wrappedBody.request as { systemInstruction?: { parts: Array<{ text: string }> } }
      expect(req.systemInstruction?.parts?.length).toBe(2)
      expect(req.systemInstruction?.parts?.[0]?.text).toBe(ANTIGRAVITY_SYSTEM_PROMPT)
      expect(req.systemInstruction?.parts?.[1]?.text).toBe("existing system prompt")
    })

    it("should preserve multiple existing parts when prepending", () => {
      // #given
      const wrappedBody = {
        project: "test-project",
        model: "gemini-3-pro-preview",
        request: {
          systemInstruction: {
            role: "user",
            parts: [
              { text: "first existing part" },
              { text: "second existing part" },
            ],
          },
        } as Record<string, unknown>,
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then
      const req = wrappedBody.request as { systemInstruction?: { parts: Array<{ text: string }> } }
      expect(req.systemInstruction?.parts?.length).toBe(3)
      expect(req.systemInstruction?.parts?.[0]?.text).toBe(ANTIGRAVITY_SYSTEM_PROMPT)
      expect(req.systemInstruction?.parts?.[1]?.text).toBe("first existing part")
      expect(req.systemInstruction?.parts?.[2]?.text).toBe("second existing part")
    })
  })

  describe("duplicate prevention", () => {
    it("should not inject if <identity> marker already exists in first part", () => {
      // #given
      const wrappedBody = {
        project: "test-project",
        model: "gemini-3-pro-preview",
        request: {
          systemInstruction: {
            role: "user",
            parts: [{ text: "some prompt with <identity> marker already" }],
          },
        } as Record<string, unknown>,
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then
      const req = wrappedBody.request as { systemInstruction?: { parts: Array<{ text: string }> } }
      expect(req.systemInstruction?.parts?.length).toBe(1)
      expect(req.systemInstruction?.parts?.[0]?.text).toBe("some prompt with <identity> marker already")
    })

    it("should inject if <identity> marker is not in first part", () => {
      // #given
      const wrappedBody = {
        project: "test-project",
        model: "gemini-3-pro-preview",
        request: {
          systemInstruction: {
            role: "user",
            parts: [
              { text: "not the identity marker" },
              { text: "some <identity> in second part" },
            ],
          },
        } as Record<string, unknown>,
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then
      const req = wrappedBody.request as { systemInstruction?: { parts: Array<{ text: string }> } }
      expect(req.systemInstruction?.parts?.length).toBe(3)
      expect(req.systemInstruction?.parts?.[0]?.text).toBe(ANTIGRAVITY_SYSTEM_PROMPT)
    })
  })

  describe("edge cases", () => {
    it("should handle request without request field", () => {
      // #given
      const wrappedBody: { project: string; model: string; request?: Record<string, unknown> } = {
        project: "test-project",
        model: "gemini-3-pro-preview",
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then - should not throw, should not modify
      expect(wrappedBody).not.toHaveProperty("systemInstruction")
    })

    it("should handle request with non-object request field", () => {
      // #given
      const wrappedBody: { project: string; model: string; request?: unknown } = {
        project: "test-project",
        model: "gemini-3-pro-preview",
        request: "not an object",
      }

      // #when
      injectSystemPrompt(wrappedBody)

      // #then - should not throw
    })
  })
})

describe("wrapRequestBody", () => {
  it("should create wrapped body with correct structure", () => {
    // #given
    const body = {
      model: "gemini-3-pro-preview",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    }
    const projectId = "test-project"
    const modelName = "gemini-3-pro-preview"
    const sessionId = "test-session"

    // #when
    const result = wrapRequestBody(body, projectId, modelName, sessionId)

    // #then
    expect(result).toHaveProperty("project", projectId)
    expect(result).toHaveProperty("model", "gemini-3-pro-preview")
    expect(result).toHaveProperty("request")
    expect(result.request).toHaveProperty("sessionId", sessionId)
    expect(result.request).toHaveProperty("contents")
    expect(result.request.contents).toEqual(body.contents)
    expect(result.request).not.toHaveProperty("model") // model should be moved to outer
  })

  it("should include systemInstruction in wrapped request", () => {
    // #given
    const body = {
      model: "gemini-3-pro-preview",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    }
    const projectId = "test-project"
    const modelName = "gemini-3-pro-preview"
    const sessionId = "test-session"

    // #when
    const result = wrapRequestBody(body, projectId, modelName, sessionId)

    // #then
    const req = result.request as { systemInstruction?: { parts: Array<{ text: string }> } }
    expect(req).toHaveProperty("systemInstruction")
    expect(req.systemInstruction?.parts?.[0]?.text).toContain("<identity>")
  })
})
