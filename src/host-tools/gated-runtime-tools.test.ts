import { describe, expect, test } from "bun:test"
import { registerGatedRuntimeTools } from "./gated-runtime-tools"
import type { TargetToolDefinition } from "./tool-registration"

function collectTools(options: { interactiveBashEnabled: boolean }): Map<string, TargetToolDefinition> {
  const tools = new Map<string, TargetToolDefinition>()
  registerGatedRuntimeTools({
    host: "pi",
    cwd: process.cwd(),
    ...options,
    registry: {
      registerTool: (tool) => {
        tools.set(tool.name, tool)
      },
    },
  })
  return tools
}

describe("registerGatedRuntimeTools", () => {
  test("#given tmux unavailable #when registering gated tools #then interactive bash is omitted", () => {
    const tools = collectTools({ interactiveBashEnabled: false })
    expect(tools.has("interactive_bash")).toBe(false)
  })

  test("#given tmux available #when registering gated tools #then interactive bash is present", () => {
    const tools = collectTools({ interactiveBashEnabled: true })
    expect(tools.has("interactive_bash")).toBe(true)
  })

  test("#given target runtime tools are registered #when registering gated tools #then look at is present", () => {
    const unsupported = registerGatedRuntimeTools({
      host: "oh-my-pi",
      cwd: process.cwd(),
      interactiveBashEnabled: false,
      registry: { registerTool: () => {} },
    }).unsupported

    const tools = collectTools({ interactiveBashEnabled: false })
    expect(unsupported).toEqual([])
    expect(tools.has("look_at")).toBe(true)
  })

  test("#given tmux available #when running scoped session lifecycle #then interactive bash executes and cleans up", async () => {
    const tools = collectTools({ interactiveBashEnabled: true })
    const sessionName = `omo-gated-test-${process.pid}`
    const createResult = await tools
      .get("interactive_bash")
      ?.execute("call-create", { tmux_command: `new-session -d -s ${sessionName}` })
    const listResult = await tools
      .get("interactive_bash")
      ?.execute("call-list", { tmux_command: `list-sessions -F '#S'` })
    const cleanupResult = await tools
      .get("interactive_bash")
      ?.execute("call-cleanup", { tmux_command: `kill-session -t ${sessionName}` })

    expect(createResult?.isError).toBeUndefined()
    expect(listResult?.content[0]).toMatchObject({ type: "text" })
    expect(listResult?.content[0]).toMatchObject({ text: expect.stringContaining(sessionName) })
    expect(cleanupResult?.isError).toBeUndefined()
  })

  test("#given tmux available #when attempting kill-server #then interactive bash blocks the command", async () => {
    const tools = collectTools({ interactiveBashEnabled: true })
    const execution = tools.get("interactive_bash")?.execute("call-1", { tmux_command: "kill-server" })

    await expect(execution).rejects.toThrow("'kill-server' is prohibited")
  })
})
