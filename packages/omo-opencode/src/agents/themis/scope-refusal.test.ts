import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const root = join(import.meta.dir, "../../..")

function readFile(relPath: string): string {
  return readFileSync(join(root, relPath), "utf-8")
}

describe("themis scope refusal", () => {
  describe("#given the default prompt", () => {
    it("#then prompt contains scope OUT section with routing table", () => {
      const content = readFile("src/agents/themis/default.ts")
      expect(content).toContain("OUT of scope")
      expect(content).toContain("Oracle")
      expect(content).toContain("Momus")
      expect(content).toContain("Metis")
      expect(content).toContain("Hephaestus")
      expect(content).toContain("Prometheus")
      expect(content).toContain("Sisyphus")
    })

    it("#then prompt contains IN scope section", () => {
      const content = readFile("src/agents/themis/default.ts")
      expect(content).toContain("IN scope")
      expect(content).toContain("Option selection")
    })

    it("#then identity constraints contain scope refusal constraint (#8)", () => {
      const content = readFile("src/agents/themis/identity-constraints.ts")
      expect(content).toContain("Scope refusal and routing")
      expect(content).toContain("Oracle")
      expect(content).toContain("Momus")
      expect(content).toContain("Metis")
      expect(content).toContain("Hephaestus")
    })

    it("#then prompt does not mention reason_argue as a direct tool call", () => {
      const content = readFile("src/agents/themis/default.ts")
      // reason_argue should not appear as a direct call (no parentheses after it)
      expect(content).not.toMatch(/reason_argue\s*\(/)
      expect(content).not.toMatch(/reason_solve\s*\(/)
    })

    it("#then GPT variant also contains scope routing", () => {
      const content = readFile("src/agents/themis/gpt.ts")
      expect(content).toContain("OUT of scope")
      expect(content).toContain("Oracle")
      expect(content).toContain("Momus")
    })
  })
})
