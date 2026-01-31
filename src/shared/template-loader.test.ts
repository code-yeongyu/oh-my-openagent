/**
 * Template Loader Tests
 *
 * Tests for loading external reference files for complex templates
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  TemplateLoader,
  createTemplateLoader,
  type TemplateVariables,
} from "./template-loader"

describe("TemplateLoader", () => {
  let loader: TemplateLoader

  beforeEach(() => {
    loader = createTemplateLoader()
  })

  describe("loading external references", () => {
    //#given template in references/ directory
    //#when loading template
    //#then should return content
    it("should load external reference files", async () => {
      loader.setMockTemplate("skill-prompt.md", "# Skill Prompt\n\nThis is a template.")
      
      const content = await loader.load("skill-prompt.md")
      
      expect(content).toContain("Skill Prompt")
    })

    it("should handle missing files gracefully", async () => {
      const content = await loader.load("nonexistent.md")
      
      expect(content).toBeNull()
    })
  })

  describe("variable substitution", () => {
    //#given template with variables
    //#when substituting variables
    //#then should replace placeholders correctly
    it("should substitute template variables", async () => {
      loader.setMockTemplate("greeting.md", "Hello, {{name}}! Welcome to {{project}}.")
      
      const content = await loader.loadWithVariables("greeting.md", {
        name: "Developer",
        project: "oh-my-opencode",
      })
      
      expect(content).toBe("Hello, Developer! Welcome to oh-my-opencode.")
    })

    it("should handle multiple occurrences of same variable", async () => {
      loader.setMockTemplate("repeat.md", "{{word}} {{word}} {{word}}")
      
      const content = await loader.loadWithVariables("repeat.md", {
        word: "test",
      })
      
      expect(content).toBe("test test test")
    })

    it("should leave unmatched variables as-is", async () => {
      loader.setMockTemplate("partial.md", "{{known}} and {{unknown}}")
      
      const content = await loader.loadWithVariables("partial.md", {
        known: "replaced",
      })
      
      expect(content).toBe("replaced and {{unknown}}")
    })
  })

  describe("backward compatibility", () => {
    //#given inline template as fallback
    //#when external file not found
    //#then should use inline fallback
    it("should support fallback to inline content", async () => {
      const content = await loader.loadWithFallback(
        "missing.md",
        "Inline fallback content"
      )
      
      expect(content).toBe("Inline fallback content")
    })

    it("should prefer external file when available", async () => {
      loader.setMockTemplate("existing.md", "External content")
      
      const content = await loader.loadWithFallback(
        "existing.md",
        "Inline fallback content"
      )
      
      expect(content).toBe("External content")
    })
  })

  describe("template caching", () => {
    it("should cache loaded templates", async () => {
      loader.setMockTemplate("cached.md", "Original content")
      
      await loader.load("cached.md")
      loader.setMockTemplate("cached.md", "Modified content")
      
      const content = await loader.load("cached.md")
      expect(content).toBe("Original content") // Still cached
    })

    it("should allow cache clearing", async () => {
      loader.setMockTemplate("cached.md", "Original content")
      await loader.load("cached.md")
      
      loader.clearCache()
      loader.setMockTemplate("cached.md", "Modified content")
      
      const content = await loader.load("cached.md")
      expect(content).toBe("Modified content")
    })
  })

  describe("references directory", () => {
    it("should use correct references path", () => {
      const path = loader.getReferencesPath("my-skill")
      expect(path).toContain("references")
      expect(path).toContain("my-skill")
    })
  })
})
