import { afterEach, describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import {
  disabledAgentMarkdown,
  globalAgentsDir,
  parseAgentFrontmatter,
  registerAgentsV2,
  renderAgentMarkdown,
} from "./v2-agents"

describe("v2 agents", () => {
  it("renders valid frontmatter plus prompt", () => {
    // given a v1-style agent config
    const markdown = renderAgentMarkdown({
      description: "test agent",
      mode: "subagent",
      model: "anthropic/claude-x",
      temperature: 0.1,
      tools: { write: false },
      prompt: "Be helpful.",
    })

    // when parsed back
    const frontmatter = parseAgentFrontmatter(markdown)

    // then v2 markdown fields are present and v1-only keys dropped
    expect(frontmatter.description).toBe("test agent")
    expect(frontmatter.mode).toBe("subagent")
    expect(frontmatter.model).toBe("anthropic/claude-x")
    expect("tools" in frontmatter).toBe(false)
    expect(markdown).toContain("Be helpful.")
    expect(markdown).toContain("managed by oh-my-openagent v2 port")
  })

  it("materializes builtin agents to an isolated config dir", async () => {
    // given an isolated XDG config home
    const previous = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = "/tmp/v2-agents-test"
    const ctx = {
      location: { directory: "/tmp/v2-agents-test-proj" },
      model: {
        default: async () => undefined,
      },
    }

    try {
      // when registered with empty plugin config
      await registerAgentsV2(ctx as unknown as Plugin.Context, {})

      // then agent files exist with valid frontmatter
      const { readdirSync, readFileSync } = await import("node:fs")
      const { join } = await import("node:path")
      const dir = globalAgentsDir()
      expect(dir).toBe("/tmp/v2-agents-test/opencode/agents")
      const files = readdirSync(dir).filter((file) => file.endsWith(".md"))
      expect(files.length).toBeGreaterThan(0)
      expect(files).toContain("sisyphus.md")
      const frontmatter = parseAgentFrontmatter(readFileSync(join(dir, "sisyphus.md"), "utf8"))
      expect(typeof frontmatter.description).toBe("string")
    } finally {
      if (previous === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previous
      }
      const { rmSync } = await import("node:fs")
      rmSync("/tmp/v2-agents-test", { recursive: true, force: true })
    }
  })

  it("renders disabled marker files", () => {
    // given nothing
    // when rendered
    // then the marker disables the agent
    expect(parseAgentFrontmatter(disabledAgentMarkdown()).disable).toBe(true)
  })
})
