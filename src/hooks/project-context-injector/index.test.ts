import { describe, it, expect, beforeEach, mock } from "bun:test"
import { createProjectContextInjectorHook } from "./index"

//#given a project context injector hook
describe("createProjectContextInjectorHook", () => {
  const mockCtx = {
    directory: "/test/project",
    client: {},
  }

  //#when the hook factory is called
  it("should return a hook with chat.message handler", () => {
    const hook = createProjectContextInjectorHook(mockCtx)
    
    //#then it should have a chat.message handler
    expect(hook["chat.message"]).toBeDefined()
    expect(typeof hook["chat.message"]).toBe("function")
  })

  //#when chat.message is called for the first time
  it("should inject project context on first message", async () => {
    const hook = createProjectContextInjectorHook(mockCtx)
    const input = { sessionID: "test-session-1", agent: "sisyphus" }
    const output = { parts: [] as Array<{ type: string; text?: string }> }

    await hook["chat.message"]?.(input, output)

    //#then it should inject project info into parts
    expect(output.parts.length).toBeGreaterThan(0)
    const textPart = output.parts.find(p => p.type === "text" && p.text?.includes("[PROJECT CONTEXT]"))
    expect(textPart).toBeDefined()
  })

  //#when chat.message is called multiple times for the same session
  it("should only inject once per session", async () => {
    const hook = createProjectContextInjectorHook(mockCtx)
    const input = { sessionID: "test-session-2", agent: "sisyphus" }
    const output1 = { parts: [] as Array<{ type: string; text?: string }> }
    const output2 = { parts: [] as Array<{ type: string; text?: string }> }

    await hook["chat.message"]?.(input, output1)
    await hook["chat.message"]?.(input, output2)

    //#then second call should not inject
    expect(output1.parts.length).toBeGreaterThan(0)
    expect(output2.parts.length).toBe(0)
  })

  //#when chat.message is called for different sessions
  it("should inject for each unique session", async () => {
    const hook = createProjectContextInjectorHook(mockCtx)
    const output1 = { parts: [] as Array<{ type: string; text?: string }> }
    const output2 = { parts: [] as Array<{ type: string; text?: string }> }

    await hook["chat.message"]?.({ sessionID: "session-a", agent: "sisyphus" }, output1)
    await hook["chat.message"]?.({ sessionID: "session-b", agent: "sisyphus" }, output2)

    //#then both sessions should get injection
    expect(output1.parts.length).toBeGreaterThan(0)
    expect(output2.parts.length).toBeGreaterThan(0)
  })

  //#when project info is detected
  it("should include package manager in context", async () => {
    const hook = createProjectContextInjectorHook(mockCtx)
    const input = { sessionID: "test-session-3", agent: "sisyphus" }
    const output = { parts: [] as Array<{ type: string; text?: string }> }

    await hook["chat.message"]?.(input, output)

    //#then package manager info should be present
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toMatch(/Package Manager:/i)
  })

  //#when project info is detected
  it("should include frameworks in context", async () => {
    const hook = createProjectContextInjectorHook(mockCtx)
    const input = { sessionID: "test-session-4", agent: "sisyphus" }
    const output = { parts: [] as Array<{ type: string; text?: string }> }

    await hook["chat.message"]?.(input, output)

    //#then frameworks info should be present
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toMatch(/Frameworks:/i)
  })

  //#when project info is detected
  it("should include code style in context", async () => {
    const hook = createProjectContextInjectorHook(mockCtx)
    const input = { sessionID: "test-session-5", agent: "sisyphus" }
    const output = { parts: [] as Array<{ type: string; text?: string }> }

    await hook["chat.message"]?.(input, output)

    //#then code style info should be present
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart?.text).toMatch(/Code Style:/i)
  })
})
