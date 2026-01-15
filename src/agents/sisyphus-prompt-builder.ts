import type { AgentPromptMetadata, BuiltinAgentName } from "./types"

export interface AvailableAgent {
  name: BuiltinAgentName
  description: string
  metadata: AgentPromptMetadata
}

export interface AvailableTool {
  name: string
  category: "lsp" | "ast" | "search" | "session" | "command" | "other"
}

export interface AvailableSkill {
  name: string
  description: string
  location: "user" | "project" | "plugin"
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
  return toolNames.map((name) => {
    let category: AvailableTool["category"] = "other"
    if (name.startsWith("lsp_")) {
      category = "lsp"
    } else if (name.startsWith("ast_grep")) {
      category = "ast"
    } else if (name === "grep" || name === "glob") {
      category = "search"
    } else if (name.startsWith("session_")) {
      category = "session"
    } else if (name === "slashcommand") {
      category = "command"
    }
    return { name, category }
  })
}

function formatToolsForPrompt(tools: AvailableTool[]): string {
  const lspTools = tools.filter((t) => t.category === "lsp")
  const astTools = tools.filter((t) => t.category === "ast")
  const searchTools = tools.filter((t) => t.category === "search")

  const parts: string[] = []

  if (searchTools.length > 0) {
    parts.push(...searchTools.map((t) => `\`${t.name}\``))
  }

  if (lspTools.length > 0) {
    parts.push("`lsp_*`")
  }

  if (astTools.length > 0) {
    parts.push("`ast_grep`")
  }

  return parts.join(", ")
}

export function buildKeyTriggersSection(agents: AvailableAgent[], skills: AvailableSkill[] = []): string {
  const keyTriggers = agents
    .filter((a) => a.metadata.keyTrigger)
    .map((a) => `- ${a.metadata.keyTrigger}`)

  const skillTriggers = skills
    .filter((s) => s.description)
    .map((s) => `- **Skill \`${s.name}\`**: ${extractTriggerFromDescription(s.description)}`)

  const allTriggers = [...keyTriggers, ...skillTriggers]

  if (allTriggers.length === 0) return ""

  return `### Key Triggers (check BEFORE classification):

**BLOCKING: Check skills FIRST before any action.**
If a skill matches, invoke it IMMEDIATELY via \`skill\` tool.

${allTriggers.join("\n")}
- **GitHub mention (@mention in issue/PR)** → This is a WORK REQUEST. Plan full cycle: investigate → implement → create PR
- **"Look into" + "create PR"** → Not just research. Full implementation cycle expected.`
}

function extractTriggerFromDescription(description: string): string {
  const triggerMatch = description.match(/Trigger[s]?[:\s]+([^.]+)/i)
  if (triggerMatch) return triggerMatch[1].trim()

  const activateMatch = description.match(/Activate when[:\s]+([^.]+)/i)
  if (activateMatch) return activateMatch[1].trim()

  const useWhenMatch = description.match(/Use (?:this )?when[:\s]+([^.]+)/i)
  if (useWhenMatch) return useWhenMatch[1].trim()

  return description.split(".")[0] || description
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  skills: AvailableSkill[] = []
): string {
  const rows: string[] = [
    "### Tool & Skill Selection:",
    "",
    "**Priority Order**: Skills → Direct Tools → Agents",
    "",
  ]

  // Skills section (highest priority)
  if (skills.length > 0) {
    rows.push("#### Skills (INVOKE FIRST if matching)")
    rows.push("")
    rows.push("| Skill | When to Use |")
    rows.push("|-------|-------------|")
    for (const skill of skills) {
      const shortDesc = extractTriggerFromDescription(skill.description)
      rows.push(`| \`${skill.name}\` | ${shortDesc} |`)
    }
    rows.push("")
  }

  // Tools and Agents table
  rows.push("#### Tools & Agents")
  rows.push("")
  rows.push("| Resource | Cost | When to Use |")
  rows.push("|----------|------|-------------|")

  if (tools.length > 0) {
    const toolsDisplay = formatToolsForPrompt(tools)
    rows.push(`| ${toolsDisplay} | FREE | Not Complex, Scope Clear, No Implicit Assumptions |`)
  }

  const costOrder = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const sortedAgents = [...agents]
    .filter((a) => a.metadata.category !== "utility")
    .sort((a, b) => costOrder[a.metadata.cost] - costOrder[b.metadata.cost])

  for (const agent of sortedAgents) {
    const shortDesc = agent.description.split(".")[0] || agent.description
    rows.push(`| \`${agent.name}\` agent | ${agent.metadata.cost} | ${shortDesc} |`)
  }

  rows.push("")
  rows.push("**Default flow**: skill (if match) → explore/librarian (background) + tools → oracle (if required)")

  return rows.join("\n")
}

export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((a) => a.name === "explore")
  if (!exploreAgent) return ""

  const useWhen = exploreAgent.metadata.useWhen || []
  const avoidWhen = exploreAgent.metadata.avoidWhen || []

  return `### Explore Agent = Contextual Grep

Use it as a **peer tool**, not a fallback. Fire liberally.

| Use Direct Tools | Use Explore Agent |
|------------------|-------------------|
${avoidWhen.map((w) => `| ${w} |  |`).join("\n")}
${useWhen.map((w) => `|  | ${w} |`).join("\n")}`
}

export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((a) => a.name === "librarian")
  if (!librarianAgent) return ""

  const useWhen = librarianAgent.metadata.useWhen || []

  return `### Librarian Agent = Reference Grep

Search **external references** (docs, OSS, web). Fire proactively when unfamiliar libraries are involved.

| Contextual Grep (Internal) | Reference Grep (External) |
|----------------------------|---------------------------|
| Search OUR codebase | Search EXTERNAL resources |
| Find patterns in THIS repo | Find examples in OTHER repos |
| How does our code work? | How does this library work? |
| Project-specific logic | Official API documentation |
| | Library best practices & quirks |
| | OSS implementation examples |

**Trigger phrases** (fire librarian immediately):
${useWhen.map((w) => `- "${w}"`).join("\n")}`
}

export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = [
    "### Delegation Table:",
    "",
    "| Domain | Delegate To | Trigger |",
    "|--------|-------------|---------|",
  ]

  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      rows.push(`| ${trigger.domain} | \`${agent.name}\` | ${trigger.trigger} |`)
    }
  }

  return rows.join("\n")
}

export function buildFrontendSection(agents: AvailableAgent[]): string {
  const frontendAgent = agents.find((a) => a.name === "frontend-ui-ux-engineer")
  if (!frontendAgent) return ""

  return `### Frontend Files: VISUAL = HARD BLOCK (zero tolerance)

**DEFAULT ASSUMPTION**: Any frontend file change is VISUAL until proven otherwise.

#### HARD BLOCK: Visual Changes (NEVER touch directly)

| Pattern | Action | No Exceptions |
|---------|--------|---------------|
| \`.tsx\`, \`.jsx\` with styling | DELEGATE | Even "just add className" |
| \`.vue\`, \`.svelte\` | DELEGATE | Even single prop change |
| \`.css\`, \`.scss\`, \`.sass\`, \`.less\` | DELEGATE | Even color/margin tweak |
| Any file with visual keywords | DELEGATE | See keyword list below |

#### Keyword Detection (INSTANT DELEGATE)

If your change involves **ANY** of these keywords → **STOP. DELEGATE.**

\`\`\`
style, className, tailwind, css, color, background, border, shadow,
margin, padding, width, height, flex, grid, animation, transition,
hover, responsive, font-size, font-weight, icon, svg, image, layout,
position, display, opacity, z-index, transform, gradient, theme
\`\`\`

**YOU CANNOT**:
- "Just quickly fix this style"
- "It's only one className"
- "Too simple to delegate"

#### EXCEPTION: Pure Logic Only

You MAY handle directly **ONLY IF ALL** conditions are met:
1. Change is **100% logic** (API, state, event handlers, types, utils)
2. **Zero** visual keywords in your diff
3. No styling, layout, or appearance changes whatsoever

| Pure Logic Examples | Visual Examples (DELEGATE) |
|---------------------|---------------------------|
| Add onClick API call | Change button color |
| Fix pagination logic | Add loading spinner animation |
| Add form validation | Make modal responsive |
| Update state management | Adjust spacing/margins |

#### Mixed Changes → SPLIT

If change has BOTH logic AND visual:
1. Handle logic yourself
2. DELEGATE visual part to \`frontend-ui-ux-engineer\`
3. **Never** combine them into one edit`
}

export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((a) => a.name === "oracle")
  if (!oracleAgent) return ""

  const useWhen = oracleAgent.metadata.useWhen || []
  const avoidWhen = oracleAgent.metadata.avoidWhen || []

  return `<Oracle_Usage>
## Oracle — Read-Only High-IQ Consultant

Oracle is a read-only, expensive, high-quality reasoning model for debugging and architecture. Consultation only.

### WHEN to Consult:

| Trigger | Action |
|---------|--------|
${useWhen.map((w) => `| ${w} | Oracle FIRST, then implement |`).join("\n")}

### WHEN NOT to Consult:

${avoidWhen.map((w) => `- ${w}`).join("\n")}

### Usage Pattern:
Briefly announce "Consulting Oracle for [reason]" before invocation.

**Exception**: This is the ONLY case where you announce before acting. For all other work, start immediately without status updates.
</Oracle_Usage>`
}

export function buildHardBlocksSection(agents: AvailableAgent[]): string {
  const frontendAgent = agents.find((a) => a.name === "frontend-ui-ux-engineer")

  const blocks = [
    "| Type error suppression (`as any`, `@ts-ignore`) | Never |",
    "| Commit without explicit request | Never |",
    "| Speculate about unread code | Never |",
    "| Leave code in broken state after failures | Never |",
  ]

  if (frontendAgent) {
    blocks.unshift(
      "| Frontend VISUAL changes (styling, className, layout, animation, any visual keyword) | **HARD BLOCK** - Always delegate to `frontend-ui-ux-engineer`. Zero tolerance. |"
    )
  }

  return `## Hard Blocks (NEVER violate)

| Constraint | No Exceptions |
|------------|---------------|
${blocks.join("\n")}`
}

export function buildAntiPatternsSection(agents: AvailableAgent[]): string {
  const frontendAgent = agents.find((a) => a.name === "frontend-ui-ux-engineer")

  const patterns = [
    "| **Type Safety** | `as any`, `@ts-ignore`, `@ts-expect-error` |",
    "| **Error Handling** | Empty catch blocks `catch(e) {}` |",
    "| **Testing** | Deleting failing tests to \"pass\" |",
    "| **Search** | Firing agents for single-line typos or obvious syntax errors |",
    "| **Debugging** | Shotgun debugging, random changes |",
  ]

  if (frontendAgent) {
    patterns.splice(
      4,
      0,
      "| **Frontend** | ANY direct edit to visual/styling code. Keyword detected = DELEGATE. Pure logic only = OK |"
    )
  }

  return `## Anti-Patterns (BLOCKING violations)

| Category | Forbidden |
|----------|-----------|
${patterns.join("\n")}`
}

export function buildUltraworkAgentSection(agents: AvailableAgent[]): string {
  if (agents.length === 0) return ""

  const ultraworkAgentPriority = ["explore", "librarian", "plan", "oracle"]
  const sortedAgents = [...agents].sort((a, b) => {
    const aIdx = ultraworkAgentPriority.indexOf(a.name)
    const bIdx = ultraworkAgentPriority.indexOf(b.name)
    if (aIdx === -1 && bIdx === -1) return 0
    if (aIdx === -1) return 1
    if (bIdx === -1) return -1
    return aIdx - bIdx
  })

  const lines: string[] = []
  for (const agent of sortedAgents) {
    const shortDesc = agent.description.split(".")[0] || agent.description
    const suffix = (agent.name === "explore" || agent.name === "librarian") ? " (multiple)" : ""
    lines.push(`- **${agent.name}${suffix}**: ${shortDesc}`)
  }

  return lines.join("\n")
}
