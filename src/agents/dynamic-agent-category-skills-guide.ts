import type {
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-types"

function buildSkillsSection(skills: AvailableSkill[]): string {
  const builtinSkills = skills.filter((skill) => skill.location === "plugin")
  const customSkills = skills.filter((skill) => skill.location !== "plugin")

  const builtinNames = builtinSkills.map((skill) => skill.name).join(", ")
  const customNames = customSkills
    .map((skill) => {
      const source = skill.location === "project" ? "project" : "user"
      return `${skill.name} (${source})`
    })
    .join(", ")

  if (customSkills.length > 0 && builtinSkills.length > 0) {
    return `#### Available Skills (via \`skill\` tool)

**Built-in**: ${builtinNames}
**⚡ YOUR SKILLS (PRIORITY)**: ${customNames}

> User-installed skills OVERRIDE built-in defaults. ALWAYS prefer YOUR SKILLS when domain matches.
> Full skill descriptions → use the \`skill\` tool to check before EVERY delegation.`
  }

  if (customSkills.length > 0) {
    return `#### Available Skills (via \`skill\` tool)

**⚡ YOUR SKILLS (PRIORITY)**: ${customNames}

> User-installed skills OVERRIDE built-in defaults. ALWAYS prefer YOUR SKILLS when domain matches.
> Full skill descriptions → use the \`skill\` tool to check before EVERY delegation.`
  }

  if (builtinSkills.length > 0) {
    return `#### Available Skills (via \`skill\` tool)

**Built-in**: ${builtinNames}

> Full skill descriptions → use the \`skill\` tool to check before EVERY delegation.`
  }

  return ""
}

export function buildCategorySkillsDelegationGuide(
  categories: AvailableCategory[],
  skills: AvailableSkill[],
): string {
  if (categories.length === 0 && skills.length === 0) {
    return ""
  }

  const categoryRows = categories.map((category) => {
    const description = category.description || category.name
    return `- \`${category.name}\` - ${description}`
  })

  const customSkills = skills.filter((skill) => skill.location !== "plugin")
  const skillsSection = buildSkillsSection(skills)
  const customPriorityNote =
    customSkills.length > 0
      ? `
> **User-installed skills get PRIORITY.** When in doubt, INCLUDE rather than omit.`
      : ""

  return `### Category + Skills Delegation System

**task() combines categories and skills for optimal task execution.**

#### Available Categories (Domain-Optimized Models)

Each category is configured with a model optimized for that domain. Read the description to understand when to use it.

${categoryRows.join("\n")}

${skillsSection}

---

### MANDATORY: Category + Skill Selection Protocol

**STEP 1: Select Category**
- Read each category's description
- Match task requirements to category domain
- Select the category whose domain BEST fits the task

**STEP 2: Evaluate ALL Skills**
Check the \`skill\` tool for available skills and their descriptions. For EVERY skill, ask:
> "Does this skill's expertise domain overlap with my task?"

- If YES → INCLUDE in \`load_skills=[...]\`
- If NO → OMIT (no justification needed)${customPriorityNote}

---

### Delegation Pattern

\`\`\`typescript
task(
  category="[selected-category]",
  load_skills=["skill-1", "skill-2"],  // Include ALL relevant skills - ESPECIALLY user-installed ones
  run_in_background=false,
  prompt="..."
)
\`\`\`

**ANTI-PATTERN (will produce poor results):**
\`\`\`typescript
task(category="...", load_skills=[], run_in_background=false, prompt="...")  // Empty load_skills without justification
\`\`\`

---

### Category Domain Matching (ZERO TOLERANCE)

Every delegation MUST use the category that matches the task's domain. Mismatched categories produce measurably worse output because each category runs on a model optimized for that specific domain.

**VISUAL WORK = ALWAYS \`visual-engineering\`. NO EXCEPTIONS.**

Any task involving UI, UX, CSS, styling, layout, animation, design, or frontend components MUST go to \`visual-engineering\`. Never delegate visual work to \`quick\`, \`unspecified-*\`, or any other category.

**NON-CODING WRITING WORK = ALWAYS \`non-coding-writing\`.**

Any task involving reports, proposals, official correspondence, policy documents, public statements, essays, creative prose, PRDs, product briefs, or other prose artifacts for non-developer readers MUST go to \`non-coding-writing\`. Use relevant writing skills such as \`locale-aware-writing\`, \`official-document-writing\`, \`creative-writing\`, \`law-policy-writing\`, or \`product-definition-writing\`.

Use \`writing\` for technical documentation such as READMEs, API docs, docstrings, and developer guides. Do not route non-coding prose through \`quick\`, \`unspecified-*\`, or the technical \`writing\` category.

\`\`\`typescript
// CORRECT: Visual work → visual-engineering category
task(category="visual-engineering", load_skills=["frontend-ui-ux"], run_in_background=false, prompt="Redesign the sidebar layout with new spacing...")

// WRONG: Visual work in wrong category - WILL PRODUCE INFERIOR RESULTS
task(category="quick", load_skills=[], run_in_background=false, prompt="Redesign the sidebar layout with new spacing...")

// CORRECT: Non-coding prose → non-coding-writing category
task(category="non-coding-writing", load_skills=["locale-aware-writing", "official-document-writing"], run_in_background=false, prompt="Draft the policy memo for a city council audience...")

// WRONG: Professional prose in technical writing category
task(category="writing", load_skills=[], run_in_background=false, prompt="Draft the policy memo for a city council audience...")
\`\`\`

| Task Domain | MUST Use Category |
|---|---|
| UI, styling, animations, layout, design | \`visual-engineering\` |
| Reports, proposals, official letters, policy documents, creative prose, PRDs | \`non-coding-writing\` |
| Hard logic, architecture decisions, algorithms | \`ultrabrain\` |
| Autonomous research + end-to-end implementation | \`deep\` |
| Single-file typo, trivial config change | \`quick\` |

**When in doubt about category, it is almost never \`quick\` or \`unspecified-*\`. Match the domain.**`
}
