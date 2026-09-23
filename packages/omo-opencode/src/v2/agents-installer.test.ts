import { describe, expect, it } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBuiltinAgents } from "../agents/builtin-agents"
import { buildAgentMarkdowns, installAgents } from "./agents-installer"

describe("#given the V1 builtin agents", () => {
  describe("#when building V2 agent markdowns", () => {
    it("#then emits one markdown per agent with description/mode frontmatter", async () => {
      // given
      const agents = await createBuiltinAgents()

      // when
      const markdowns = await buildAgentMarkdowns()

      // then
      expect(markdowns.map((markdown) => markdown.filename).sort()).toEqual(
        Object.keys(agents).map((name) => `${name}.md`).sort(),
      )
      for (const markdown of markdowns) {
        expect(markdown.content).toContain("description:")
        expect(markdown.content).toContain("mode:")
        expect(markdown.content.length).toBeGreaterThan(100)
      }
    })
  })

  describe("#when installing agents to a temp dir", () => {
    it("#then writes one file per agent", async () => {
      // given
      const targetDir = mkdtempSync(join(tmpdir(), "omo-v2-agents-"))

      // when
      const result = await installAgents(targetDir)

      // then
      const markdowns = await buildAgentMarkdowns()
      expect(result.written.length).toBe(markdowns.length)
      expect(readdirSync(targetDir).sort()).toEqual(
        markdowns.map((markdown) => markdown.filename).sort(),
      )
      const first = readFileSync(result.written[0] as string, "utf-8")
      expect(first.startsWith("---\n")).toBe(true)
    })
  })
})
