import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, test, mock, spyOn, afterEach } from "bun:test"
import { createSandboxGateHook } from "./hook"
import { SandboxManager } from "./sandbox-manager"
import type { OhMyOpenCodeConfig } from "../../config"

describe("sandbox-gate hook", () => {
  function mockPluginInput() {
    const promptAsyncMock = mock(() => Promise.resolve({}))
    return {
      directory: "/fake/dir",
      client: {
        session: {
          promptAsync: promptAsyncMock,
        },
      },
    } as unknown as PluginInput
  }

  function mockConfig(): OhMyOpenCodeConfig {
    return {
      sandbox_verify_command: "npm run compile",
    } as any as OhMyOpenCodeConfig
  }

  afterEach(() => {
    mock.restore()
  })

  test("should allow idle state when verification succeeds", async () => {
    const ctx = mockPluginInput()
    const hook = createSandboxGateHook(ctx, mockConfig())
    const sessionID = "ses_sandbox_ok"

    // Mock SandboxManager.prototype.verify
    const verifySpy = spyOn(SandboxManager.prototype, "verify").mockImplementation(async () => {
      return { success: true, output: "Compile passed." }
    })

    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    expect(verifySpy).toHaveBeenCalled()
    expect(ctx.client.session.promptAsync).not.toHaveBeenCalled()
  })

  test("should trigger repair loop up to 3 times on verification failure", async () => {
    const ctx = mockPluginInput()
    const hook = createSandboxGateHook(ctx, mockConfig())
    const sessionID = "ses_sandbox_fail"

    const verifySpy = spyOn(SandboxManager.prototype, "verify").mockImplementation(async () => {
      return { success: false, output: "SyntaxError: Unexpected token" }
    })

    // Attempt 1
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    expect(verifySpy).toHaveBeenCalledTimes(1)
    expect(ctx.client.session.promptAsync).toHaveBeenCalledTimes(1)
    
    const mockCalls = (ctx.client.session.promptAsync as any).mock.calls
    expect(mockCalls[0][0].body.parts[0].text).toContain("Compiler or test suite returned errors")

    // Attempt 2
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    expect(verifySpy).toHaveBeenCalledTimes(2)
    expect(ctx.client.session.promptAsync).toHaveBeenCalledTimes(2)

    // Attempt 3
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    expect(verifySpy).toHaveBeenCalledTimes(3)
    expect(ctx.client.session.promptAsync).toHaveBeenCalledTimes(3)

    // Attempt 4 - should reach max retries (3) and stop
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    expect(verifySpy).toHaveBeenCalledTimes(3) // verify not called again
    expect(ctx.client.session.promptAsync).toHaveBeenCalledTimes(3) // promptAsync not called again
  })
})
