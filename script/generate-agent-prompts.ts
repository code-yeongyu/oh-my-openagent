/**
 * Generate prompt documentation for all agents.
 *
 * Usage: bun run script/generate-agent-prompts.ts
 *
 * Produces one markdown file per agent in the `prompt/` directory,
 * mirroring the format of the original `sisyphus-prompt.md`.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { createSisyphusAgent, SISYPHUS_PROMPT_METADATA } from "../src/agents/sisyphus"
import { createHephaestusAgent } from "../src/agents/hephaestus"
import { createAtlasAgent, atlasPromptMetadata } from "../src/agents/atlas/agent"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "../src/agents/oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "../src/agents/librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "../src/agents/explore"
import {
  createMultimodalLookerAgent,
  MULTIMODAL_LOOKER_PROMPT_METADATA,
} from "../src/agents/multimodal-looker"
import { createMomusAgent, momusPromptMetadata } from "../src/agents/momus"
import { createMetisAgent, metisPromptMetadata } from "../src/agents/metis"
import {
  DEFAULT_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
} from "../src/tools/delegate-task/constants"
import type {
  AvailableAgent,
  AvailableSkill,
  AvailableCategory,
} from "../src/agents/dynamic-agent-prompt-builder"
import type { AgentConfig } from "@opencode-ai/sdk"

// ---------------------------------------------------------------------------
// Shared context for dynamic agents
// ---------------------------------------------------------------------------

const availableAgents: AvailableAgent[] = [
  {
    name: "oracle",
    description: "Read-only consultation agent",
    metadata: ORACLE_PROMPT_METADATA,
  },
  {
    name: "librarian",
    description:
      "Specialized codebase understanding agent for multi-repository analysis, searching remote codebases, retrieving official documentation, and finding implementation examples using GitHub CLI, Context7, and Web Search",
    metadata: LIBRARIAN_PROMPT_METADATA,
  },
  {
    name: "explore",
    description: "Contextual grep for codebases",
    metadata: EXPLORE_PROMPT_METADATA,
  },
  {
    name: "multimodal-looker",
    description:
      "Analyze media files (PDFs, images, diagrams) that require interpretation beyond raw text",
    metadata: MULTIMODAL_LOOKER_PROMPT_METADATA,
  },
]

const availableSkills: AvailableSkill[] = [
  {
    name: "playwright",
    description: "MUST USE for any browser-related tasks",
    location: "project",
  },
  {
    name: "frontend-ui-ux",
    description:
      "Designer-turned-developer who crafts stunning UI/UX even without design mockups",
    location: "project",
  },
  {
    name: "git-master",
    description: "MUST USE for ANY git operations",
    location: "project",
  },
]

const availableCategories: AvailableCategory[] = Object.entries(
  DEFAULT_CATEGORIES,
)
  .filter(([name]) => name in CATEGORY_DESCRIPTIONS)
  .map(([name, config]) => ({
    name,
    description:
      CATEGORY_DESCRIPTIONS[name as keyof typeof CATEGORY_DESCRIPTIONS] ?? name,
    model: config.model,
  }))

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

interface AgentDef {
  name: string
  displayName: string
  defaultModel: string
  create: () => AgentConfig
  isDynamic: boolean
}

const agents: AgentDef[] = [
  {
    name: "sisyphus",
    displayName: "Sisyphus",
    defaultModel: "anthropic/claude-opus-4-6",
    create: () =>
      createSisyphusAgent(
        "anthropic/claude-opus-4-6",
        availableAgents,
        [],
        availableSkills,
        availableCategories,
      ),
    isDynamic: true,
  },
  {
    name: "hephaestus",
    displayName: "Hephaestus",
    defaultModel: "openai/gpt-5.3-codex",
    create: () =>
      createHephaestusAgent(
        "openai/gpt-5.3-codex",
        availableAgents,
        [],
        availableSkills,
        availableCategories,
      ),
    isDynamic: true,
  },
  {
    name: "atlas",
    displayName: "Atlas",
    defaultModel: "anthropic/claude-opus-4-6",
    create: () =>
      createAtlasAgent({
        model: "anthropic/claude-opus-4-6",
        availableAgents,
        availableSkills,
      }),
    isDynamic: true,
  },
  {
    name: "oracle",
    displayName: "Oracle",
    defaultModel: "anthropic/claude-opus-4-6",
    create: () => createOracleAgent("anthropic/claude-opus-4-6"),
    isDynamic: false,
  },
  {
    name: "librarian",
    displayName: "Librarian",
    defaultModel: "anthropic/claude-sonnet-4-6",
    create: () => createLibrarianAgent("anthropic/claude-sonnet-4-6"),
    isDynamic: false,
  },
  {
    name: "explore",
    displayName: "Explore",
    defaultModel: "anthropic/claude-haiku-4-5",
    create: () => createExploreAgent("anthropic/claude-haiku-4-5"),
    isDynamic: false,
  },
  {
    name: "multimodal-looker",
    displayName: "Multimodal Looker",
    defaultModel: "anthropic/claude-sonnet-4-6",
    create: () => createMultimodalLookerAgent("anthropic/claude-sonnet-4-6"),
    isDynamic: false,
  },
  {
    name: "momus",
    displayName: "Momus",
    defaultModel: "anthropic/claude-opus-4-6",
    create: () => createMomusAgent("anthropic/claude-opus-4-6"),
    isDynamic: false,
  },
  {
    name: "metis",
    displayName: "Metis",
    defaultModel: "anthropic/claude-opus-4-6",
    create: () => createMetisAgent("anthropic/claude-opus-4-6"),
    isDynamic: false,
  },
]

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function formatThinking(config: AgentConfig): string {
  const thinking = (config as Record<string, unknown>).thinking as
    | { type: string; budgetTokens?: number }
    | undefined
  if (thinking?.type === "enabled") {
    return `Budget: ${thinking.budgetTokens ?? "default"}`
  }
  const effort = (config as Record<string, unknown>).reasoningEffort as
    | string
    | undefined
  if (effort) {
    return `Reasoning effort: ${effort}`
  }
  return "N/A"
}

function generateMarkdown(def: AgentDef, config: AgentConfig, now: string): string {
  const lines: string[] = []

  lines.push(`# ${def.displayName} System Prompt`)
  lines.push("")
  lines.push("> Auto-generated by `script/generate-agent-prompts.ts`")
  lines.push(`> Generated at: ${now}`)
  lines.push("")

  // Configuration table
  lines.push("## Configuration")
  lines.push("")
  lines.push("| Field | Value |")
  lines.push("|-------|-------|")
  lines.push(`| Model | \`${config.model ?? def.defaultModel}\` |`)
  lines.push(`| Max Tokens | \`${config.maxTokens ?? "default"}\` |`)
  lines.push(`| Mode | \`${config.mode}\` |`)
  lines.push(`| Thinking | ${formatThinking(config)} |`)
  const temp = (config as Record<string, unknown>).temperature as
    | number
    | undefined
  lines.push(`| Temperature | ${temp != null ? temp : "N/A"} |`)
  lines.push("")

  // Description
  lines.push("## Description")
  lines.push("")
  lines.push(config.description ?? "_(no description)_")
  lines.push("")

  // Dynamic sections (only for dynamic agents)
  if (def.isDynamic) {
    lines.push("## Available Agents")
    lines.push("")
    for (const agent of availableAgents) {
      lines.push(`- **${agent.name}**: ${agent.description}`)
    }
    lines.push("")

    lines.push("## Available Categories")
    lines.push("")
    for (const cat of availableCategories) {
      lines.push(`- **${cat.name}**: ${cat.description}`)
    }
    lines.push("")

    lines.push("## Available Skills")
    lines.push("")
    for (const skill of availableSkills) {
      lines.push(`- **${skill.name}**: ${skill.description}`)
    }
    lines.push("")
  }

  // Full system prompt
  lines.push("---")
  lines.push("")
  lines.push("## Full System Prompt")
  lines.push("")
  lines.push("```markdown")
  lines.push((config.prompt as string) ?? "")
  lines.push("```")
  lines.push("")

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(import.meta.dir))
const PROMPT_DIR = resolve(ROOT, "prompt")

mkdirSync(PROMPT_DIR, { recursive: true })

const now = new Date().toISOString()

for (const def of agents) {
  const config = def.create()
  const md = generateMarkdown(def, config, now)
  const outPath = resolve(PROMPT_DIR, `${def.name}-prompt.md`)
  writeFileSync(outPath, md, "utf-8")
  console.log(`  wrote ${outPath}`)
}

console.log(`\nDone — ${agents.length} prompt files generated in prompt/`)
