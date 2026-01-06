import { describe, expect, test } from "bun:test"
import { createPrometheusMdOnlyHook } from "./index"

describe("prometheus-md-only", () => {
  function createMockPluginInput() {
    return {
      client: {},
      directory: "/tmp/test",
    } as any
  }

  test("should block Prometheus from writing non-.md files", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Write",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { filePath: "/path/to/file.ts" },
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).rejects.toThrow("can only write/edit .md files")
  })

  test("should allow Prometheus to write .md files inside .sisyphus/", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Write",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { filePath: "/project/.sisyphus/plans/work-plan.md" },
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).resolves.toBeUndefined()
  })

  test("should block Prometheus from writing .md files outside .sisyphus/", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Write",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { filePath: "/path/to/README.md" },
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).rejects.toThrow("can only write/edit .md files inside .sisyphus/")
  })

  test("should not affect non-Prometheus agents", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Write",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Sisyphus",
    }
    const output = {
      args: { filePath: "/path/to/file.ts" },
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).resolves.toBeUndefined()
  })

  test("should not affect non-Write/Edit tools", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Read",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { filePath: "/path/to/file.ts" },
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).resolves.toBeUndefined()
  })

  test("should block Edit tool for non-.md files", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Edit",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { filePath: "/path/to/code.py" },
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).rejects.toThrow("can only write/edit .md files")
  })

  test("should handle missing filePath gracefully", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Write",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: {},
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).resolves.toBeUndefined()
  })

  test("should handle missing agent gracefully", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "Write",
      sessionID: "test-session",
      callID: "call-1",
    }
    const output = {
      args: { filePath: "/path/to/file.ts" },
    }

    // #when / #then
    await expect(
      hook["tool.execute.before"](input, output)
    ).resolves.toBeUndefined()
  })

  test("should inject read-only warning when Prometheus calls sisyphus_task", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "sisyphus_task",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { prompt: "Analyze this codebase" },
    }

    // #when
    await hook["tool.execute.before"](input, output)

    // #then
    expect(output.args.prompt).toContain("[SYSTEM DIRECTIVE - READ-ONLY PLANNING CONSULTATION]")
    expect(output.args.prompt).toContain("DO NOT modify any files")
  })

  test("should inject read-only warning when Prometheus calls task", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "task",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { prompt: "Research this library" },
    }

    // #when
    await hook["tool.execute.before"](input, output)

    // #then
    expect(output.args.prompt).toContain("[SYSTEM DIRECTIVE - READ-ONLY PLANNING CONSULTATION]")
  })

  test("should inject read-only warning when Prometheus calls call_omo_agent", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "call_omo_agent",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const output = {
      args: { prompt: "Find implementation examples" },
    }

    // #when
    await hook["tool.execute.before"](input, output)

    // #then
    expect(output.args.prompt).toContain("[SYSTEM DIRECTIVE - READ-ONLY PLANNING CONSULTATION]")
  })

  test("should not inject warning for non-Prometheus agents calling sisyphus_task", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "sisyphus_task",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Sisyphus",
    }
    const originalPrompt = "Implement this feature"
    const output = {
      args: { prompt: originalPrompt },
    }

    // #when
    await hook["tool.execute.before"](input, output)

    // #then
    expect(output.args.prompt).toBe(originalPrompt)
    expect(output.args.prompt).not.toContain("[SYSTEM DIRECTIVE - READ-ONLY PLANNING CONSULTATION]")
  })

  test("should not double-inject warning if already present", async () => {
    // #given
    const hook = createPrometheusMdOnlyHook(createMockPluginInput())
    const input = {
      tool: "sisyphus_task",
      sessionID: "test-session",
      callID: "call-1",
      agent: "Prometheus (Planner)",
    }
    const promptWithWarning = "Some prompt [SYSTEM DIRECTIVE - READ-ONLY PLANNING CONSULTATION] already here"
    const output = {
      args: { prompt: promptWithWarning },
    }

    // #when
    await hook["tool.execute.before"](input, output)

    // #then
    const occurrences = (output.args.prompt as string).split("[SYSTEM DIRECTIVE - READ-ONLY PLANNING CONSULTATION]").length - 1
    expect(occurrences).toBe(1)
  })
})
