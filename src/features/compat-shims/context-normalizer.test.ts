import { describe, expect, it } from "bun:test"
import { normalizeLegacyContext } from "./context-normalizer"
import type { LegacyContextFile } from "./types"

describe("compat-shims/context-normalizer", () => {
  //#given valid legacy markdown with frontmatter
  //#when normalizeLegacyContext is called
  //#then it uses frontmatter topic, strips frontmatter from content, and normalizes tags
  it("normalizes valid legacy context with frontmatter", () => {
    const file: LegacyContextFile = {
      filename: "agent-routing-patterns.md",
      source: "opencode-context",
      content: [
        "---",
        "topic: Routing",
        "tags:",
        "  - agents",
        "  - orchestration",
        "---",
        "# Content",
        "Details here",
      ].join("\n"),
    }

    const result = normalizeLegacyContext(file)

    expect(result.topic).toBe("Routing")
    expect(result.content).toContain("# Content")
    expect(result.content).not.toContain("topic: Routing")
    expect(result.tags).toEqual(["agents", "orchestration", "opencode-context"])
    expect(result.source).toBe("opencode-context")
    expect(result.normalizedAt).toBeGreaterThan(0)
  })

  //#given malformed frontmatter
  //#when normalizeLegacyContext is called
  //#then it falls back to filename-based topic and keeps original content safely
  it("handles malformed frontmatter safely", () => {
    const file: LegacyContextFile = {
      filename: "task-resume.md",
      source: "sisyphus-plan",
      content: [
        "---",
        "topic: [not valid yaml",
        "---",
        "Body content",
      ].join("\n"),
    }

    const result = normalizeLegacyContext(file)

    expect(result.topic).toBe("task resume")
    expect(result.content).toContain("Body content")
    expect(result.tags).toEqual(["sisyphus-plan"])
  })

  //#given empty filename and empty content
  //#when normalizeLegacyContext is called
  //#then it returns safe default values
  it("handles empty input values", () => {
    const file: LegacyContextFile = {
      filename: "",
      source: "hooks-config",
      content: "",
    }

    const result = normalizeLegacyContext(file)

    expect(result.topic).toBe("untitled")
    expect(result.content).toBe("")
    expect(result.tags).toEqual(["hooks-config"])
    expect(result.source).toBe("hooks-config")
  })
})
