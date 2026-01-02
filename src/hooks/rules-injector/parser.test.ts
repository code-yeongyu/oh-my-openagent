import { describe, expect, it } from "bun:test";
import { parseRuleFrontmatter } from "./parser";

describe("parseRuleFrontmatter", () => {
  describe("applyTo field (GitHub Copilot format)", () => {
    it("should parse applyTo as single string", () => {
      // #given frontmatter with applyTo as single string
      const content = `---
applyTo: "*.ts"
---
Rule content here`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then globs should contain the pattern
      expect(result.metadata.globs).toBe("*.ts");
      expect(result.body).toBe("Rule content here");
    });

    it("should parse applyTo as inline array", () => {
      // #given frontmatter with applyTo as inline array
      const content = `---
applyTo: ["*.ts", "*.tsx"]
---
Rule content`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then globs should be array
      expect(result.metadata.globs).toEqual(["*.ts", "*.tsx"]);
    });

    it("should parse applyTo as multi-line array", () => {
      // #given frontmatter with applyTo as multi-line array
      const content = `---
applyTo:
  - "*.ts"
  - "src/**/*.js"
---
Content`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then globs should be array
      expect(result.metadata.globs).toEqual(["*.ts", "src/**/*.js"]);
    });

    it("should parse applyTo as comma-separated string", () => {
      // #given frontmatter with comma-separated applyTo
      const content = `---
applyTo: "*.ts, *.js"
---
Content`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then globs should be array
      expect(result.metadata.globs).toEqual(["*.ts", "*.js"]);
    });

    it("should merge applyTo and globs when both present", () => {
      // #given frontmatter with both applyTo and globs
      const content = `---
globs: "*.md"
applyTo: "*.ts"
---
Content`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should merge both into globs array
      expect(result.metadata.globs).toEqual(["*.md", "*.ts"]);
    });

    it("should parse applyTo without quotes", () => {
      // #given frontmatter with unquoted applyTo
      const content = `---
applyTo: **/*.py
---
Python rules`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should parse correctly
      expect(result.metadata.globs).toBe("**/*.py");
    });

    it("should parse applyTo with description", () => {
      // #given frontmatter with applyTo and description (GitHub Copilot style)
      const content = `---
applyTo: "**/*.ts,**/*.tsx"
description: "TypeScript coding standards"
---
# TypeScript Guidelines`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should parse both fields
      expect(result.metadata.globs).toEqual(["**/*.ts", "**/*.tsx"]);
      expect(result.metadata.description).toBe("TypeScript coding standards");
    });
  });

  describe("existing globs/paths parsing (backward compatibility)", () => {
    it("should still parse globs field correctly", () => {
      // #given existing globs format
      const content = `---
globs: ["*.py", "**/*.ts"]
---
Python/TypeScript rules`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should work as before
      expect(result.metadata.globs).toEqual(["*.py", "**/*.ts"]);
    });

    it("should still parse paths field as alias", () => {
      // #given paths field (Claude Code style)
      const content = `---
paths: ["src/**"]
---
Source rules`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should map to globs
      expect(result.metadata.globs).toEqual(["src/**"]);
    });

    it("should parse alwaysApply correctly", () => {
      // #given frontmatter with alwaysApply
      const content = `---
alwaysApply: true
---
Always apply this rule`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should recognize alwaysApply
      expect(result.metadata.alwaysApply).toBe(true);
    });
  });

  describe("no frontmatter", () => {
    it("should return empty metadata and full body for plain markdown", () => {
      // #given markdown without frontmatter
      const content = `# Instructions
This is a plain rule file without frontmatter.`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should have empty metadata
      expect(result.metadata).toEqual({});
      expect(result.body).toBe(content);
    });

    it("should handle empty content", () => {
      // #given empty content
      const content = "";

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should return empty metadata and body
      expect(result.metadata).toEqual({});
      expect(result.body).toBe("");
    });
  });

  describe("edge cases", () => {
    it("should handle frontmatter with only applyTo", () => {
      // #given minimal GitHub Copilot format
      const content = `---
applyTo: "**"
---
Apply to all files`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should parse correctly
      expect(result.metadata.globs).toBe("**");
      expect(result.body).toBe("Apply to all files");
    });

    it("should handle mixed array formats", () => {
      // #given globs as multi-line and applyTo as inline
      const content = `---
globs:
  - "*.md"
applyTo: ["*.ts", "*.js"]
---
Mixed format`;

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should merge both
      expect(result.metadata.globs).toEqual(["*.md", "*.ts", "*.js"]);
    });

    it("should handle Windows-style line endings", () => {
      // #given content with CRLF
      const content = "---\r\napplyTo: \"*.ts\"\r\n---\r\nWindows content";

      // #when parsing
      const result = parseRuleFrontmatter(content);

      // #then should parse correctly
      expect(result.metadata.globs).toBe("*.ts");
      expect(result.body).toBe("Windows content");
    });
  });
});
