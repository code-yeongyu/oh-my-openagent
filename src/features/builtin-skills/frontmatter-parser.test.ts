import { describe, it, expect } from "bun:test";
import { parseSkillFrontmatter } from "./frontmatter-parser";

describe("parseSkillFrontmatter", () => {
  //#given: A SKILL.md content with full frontmatter
  it("should parse hooks, triggers, and priority from YAML frontmatter", () => {
    const content = `---
hooks:
  - pre-commit
  - post-push
triggers:
  - commit
  - push
priority: high
---
# My Skill
Description here.`;

    //#when: parsing the content
    const result = parseSkillFrontmatter(content);

    //#then: it should return the parsed values
    expect(result.hooks).toEqual(["pre-commit", "post-push"]);
    expect(result.triggers).toEqual(["commit", "push"]);
    expect(result.priority).toBe("high");
    expect(result.content).toContain("# My Skill");
  });

  //#given: A SKILL.md content with partial frontmatter
  it("should handle partial frontmatter", () => {
    const content = `---
triggers:
  - test
---
# Test Skill`;

    //#when: parsing the content
    const result = parseSkillFrontmatter(content);

    //#then: it should return parsed triggers and defaults for others
    expect(result.triggers).toEqual(["test"]);
    expect(result.hooks).toEqual([]);
    expect(result.priority).toBe("medium"); // default
  });

  //#given: A SKILL.md content without frontmatter
  it("should handle SKILL.md without frontmatter", () => {
    const content = `# Standard Skill
No frontmatter here.`;

    //#when: parsing the content
    const result = parseSkillFrontmatter(content);

    //#then: it should return default values and full content
    expect(result.hooks).toEqual([]);
    expect(result.triggers).toEqual([]);
    expect(result.priority).toBe("medium");
    expect(result.content).toBe(content);
  });

  //#given: A SKILL.md content with empty frontmatter
  it("should handle empty frontmatter", () => {
    const content = `---
---
# Empty Frontmatter`;

    //#when: parsing the content
    const result = parseSkillFrontmatter(content);

    //#then: it should return default values
    expect(result.hooks).toEqual([]);
    expect(result.triggers).toEqual([]);
    expect(result.priority).toBe("medium");
  });
});
