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
})
