import agentBrowserSkillFile from "../agent-browser/SKILL.md" with { type: "text" }

const FRONTMATTER_BOUNDARY = "---"

function stripSkillFrontmatter(markdown: string): string {
  const lines = markdown.split("\n")
  if (lines[0] !== FRONTMATTER_BOUNDARY) {
    return markdown
  }

  const closingBoundaryIndex = lines.indexOf(FRONTMATTER_BOUNDARY, 1)
  if (closingBoundaryIndex === -1) {
    return markdown
  }

  return lines.slice(closingBoundaryIndex + 1).join("\n").trim().replaceAll(" — ", " - ")
}

export const agentBrowserTemplate = stripSkillFrontmatter(agentBrowserSkillFile)
