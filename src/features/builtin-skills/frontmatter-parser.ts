import yaml from "js-yaml";

export interface SkillFrontmatter {
  hooks: string[];
  triggers: string[];
  priority: "high" | "medium" | "low";
  content: string;
}

/**
 * Parses YAML frontmatter from a SKILL.md file.
 * Supports: hooks, triggers, priority.
 * 
 * @param content The full content of the SKILL.md file.
 * @returns Parsed frontmatter and the remaining content.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = content.match(frontmatterRegex);

  const defaults: SkillFrontmatter = {
    hooks: [],
    triggers: [],
    priority: "medium",
    content: content,
  };

  if (!match) {
    return defaults;
  }

  const yamlContent = match[1];
  const remainingContent = content.replace(frontmatterRegex, "");

  try {
    const parsed = yaml.load(yamlContent) as Partial<Omit<SkillFrontmatter, "content">>;
    
    return {
      hooks: Array.isArray(parsed?.hooks) ? parsed.hooks : [],
      triggers: Array.isArray(parsed?.triggers) ? parsed.triggers : [],
      priority: (parsed?.priority === "high" || parsed?.priority === "low") ? parsed.priority : "medium",
      content: remainingContent,
    };
  } catch (e) {
    // If YAML parsing fails, treat it as no frontmatter or partial failure
    return {
      ...defaults,
      content: remainingContent,
    };
  }
}
