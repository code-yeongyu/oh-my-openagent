import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { loadAgents, registerAgent, resolveToolRule } from "../index"
import { clearRegisteredAgentsForTests } from "./registry"

const fixtureRoots: string[] = []

function makeFixture(): { readonly home: string; readonly project: string } {
  const root = mkdtempSync(join(tmpdir(), "senpi-agents-"))
  fixtureRoots.push(root)
  return { home: join(root, "home"), project: join(root, "project") }
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
}

function agentMarkdown(model: string, prompt: string): string {
  return `---
description: ${model} agent
model: ${model}
---
${prompt}
`
}

afterEach(() => {
  clearRegisteredAgentsForTests()
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("loadAgents", () => {
  test("#given home and project files #when loading #then later configured locations override earlier names", () => {
    // given
    const fixture = makeFixture()
    writeText(join(fixture.home, ".pi", "agent", "agent", "finder.md"), agentMarkdown("home-pi", "home pi"))
    writeText(join(fixture.home, ".senpi", "agent", "agent", "finder.md"), agentMarkdown("home-senpi", "home senpi"))
    writeText(join(fixture.project, ".pi", "agent", "finder.md"), agentMarkdown("project-pi", "project pi"))
    writeText(join(fixture.project, ".senpi", "agents", "agents", "finder.md"), agentMarkdown("project-senpi", "project senpi"))

    // when
    const result = loadAgents({ homeDir: fixture.home, projectDir: fixture.project })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.agents.finder?.model).toBe("project-senpi")
    expect(result.agents.finder?.prompt).toBe("project senpi\n")
  })

  test("#given markdown at a configured root #when loading #then only agent subdirectories are scanned", () => {
    // given
    const fixture = makeFixture()
    writeText(join(fixture.project, ".senpi", "ignored.md"), agentMarkdown("ignored", "ignored"))
    writeText(join(fixture.project, ".senpi", "agent", "kept.md"), agentMarkdown("kept", "kept"))

    // when
    const result = loadAgents({ homeDir: fixture.home, projectDir: fixture.project })

    // then
    expect(result.agents.ignored).toBeUndefined()
    expect(result.agents.kept?.model).toBe("kept")
  })

  test("#given file and programmatic definitions #when loading #then registerAgent overrides file values", () => {
    // given
    const fixture = makeFixture()
    writeText(join(fixture.project, ".pi", "agents", "writer.md"), agentMarkdown("file-model", "file prompt"))
    registerAgent({ name: "writer", model: "registered-model", prompt: "registered prompt" })

    // when
    const result = loadAgents({ homeDir: fixture.home, projectDir: fixture.project })

    // then
    expect(result.agents.writer?.model).toBe("registered-model")
    expect(result.agents.writer?.prompt).toBe("registered prompt")
  })

  test("#given file programmatic and omo config definitions #when loading #then omo agents overlay wins last", () => {
    // given
    const fixture = makeFixture()
    writeText(join(fixture.project, ".pi", "agents", "finder.md"), agentMarkdown("file-model", "file prompt"))
    registerAgent({ name: "finder", model: "registered-model" })
    writeText(join(fixture.project, ".omo", "omo.json"), `{"agents":{"finder":{"model":"omo-model"}}}`)

    // when
    const result = loadAgents({ homeDir: fixture.home, projectDir: fixture.project })

    // then
    expect(result.agents.finder?.model).toBe("omo-model")
    expect(result.agents.finder?.prompt).toBe("file prompt\n")
  })

  test("#given malformed and valid frontmatter #when loading #then diagnostics are per file and valid agents still load", () => {
    // given
    const fixture = makeFixture()
    const badPath = join(fixture.project, ".senpi", "agent", "broken.md")
    writeText(badPath, "---\nmodel: [unterminated\n---\nBad")
    writeText(join(fixture.project, ".senpi", "agent", "valid.md"), agentMarkdown("valid-model", "Valid"))

    // when
    const result = loadAgents({ homeDir: fixture.home, projectDir: fixture.project })

    // then
    expect(result.agents.valid?.model).toBe("valid-model")
    expect(result.agents.broken).toBeUndefined()
    expect(result.diagnostics).toContainEqual({
      kind: "frontmatter",
      path: badPath,
      message: `Malformed YAML frontmatter in ${badPath}`,
    })
  })

  test("#given repeated tool allow and deny rules #when resolving a tool #then the last matching rule wins", () => {
    // given
    const fixture = makeFixture()
    writeText(
      join(fixture.project, ".pi", "agent", "guarded.md"),
      `---
tools:
  - pattern: shell
    allow: true
  - pattern: read
    action: allow
  - pattern: shell
    deny: true
---
Guarded
`,
    )

    // when
    const result = loadAgents({ homeDir: fixture.home, projectDir: fixture.project })
    const rules = result.agents.guarded?.tools ?? []

    // then
    expect(resolveToolRule(rules, "read")).toBe(true)
    expect(resolveToolRule(rules, "shell")).toBe(false)
    expect(resolveToolRule(rules, "write")).toBeUndefined()
  })

  test("#given snake case omo agent keys #when loading #then fields normalize to camelCase definitions", () => {
    // given
    const fixture = makeFixture()
    writeText(
      join(fixture.project, ".omo", "omo.json"),
      JSON.stringify({
        agents: {
          planner: {
            execution_mode: "process",
            allowed_subagents: ["worker"],
            disallowed_tools: ["shell"],
            max_depth: 2,
            max_turns: 9,
          },
        },
      }),
    )

    // when
    const result = loadAgents({ homeDir: fixture.home, projectDir: fixture.project })

    // then
    expect(result.agents.planner?.executionMode).toBe("process")
    expect(result.agents.planner?.allowedSubagents).toEqual(["worker"])
    expect(result.agents.planner?.disallowedTools).toEqual(["shell"])
    expect(result.agents.planner?.maxDepth).toBe(2)
    expect(result.agents.planner?.maxTurns).toBe(9)
  })
})
