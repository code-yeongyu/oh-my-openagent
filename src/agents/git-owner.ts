import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import type { CustomAgentConfig } from "../config/schema"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { dirname, resolve } from "path"
import { homedir } from "os"

const MODE: AgentMode = "subagent"

export const GIT_OWNER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Git Owner",
  triggers: [
    { domain: "Git operations", trigger: "Any commit, branch, merge, rebase, or tag operation" },
    { domain: "Pull requests", trigger: "Creating, updating, or reviewing PRs" },
    { domain: "Git safety", trigger: "Force push, history rewrite, protected branch operations" },
  ],
  useWhen: [
    "Creating commits with proper conventions",
    "Branch management (create, merge, delete)",
    "Pull request creation and management",
    "Git history operations (rebase, cherry-pick, revert)",
    "Enforcing git safety guardrails",
  ],
  avoidWhen: [
    "Reading file contents (use read tool directly)",
    "Code implementation (use coding agents)",
    "Non-git file operations",
  ],
}

function resolvePath(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(homedir(), filePath.slice(2))
  }
  return resolve(filePath)
}

function safeReadFile(filePath: string): string | undefined {
  const resolved = resolvePath(filePath)
  if (!existsSync(resolved)) return undefined
  return readFileSync(resolved, "utf-8")
}

function initializeDecisionsFile(filePath: string): void {
  const resolved = resolvePath(filePath)
  if (existsSync(resolved)) return

  const dir = dirname(resolved)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(resolved, "", "utf-8")
}

function buildSystemPrompt(
  ownerContent: string | undefined,
  constraintsContent: string | undefined,
): string {
  const parts: string[] = []

  if (ownerContent) {
    parts.push(ownerContent)
  } else {
    parts.push(DEFAULT_GIT_OWNER_PROMPT)
  }

  if (constraintsContent) {
    parts.push(`\n\n## Constraints Reference (Machine-Readable)\n\n\`\`\`yaml\n${constraintsContent}\n\`\`\``)
  }

  return parts.join("\n")
}

const DEFAULT_GIT_OWNER_PROMPT = `# Git & GitHub Owner

You are the **Git & GitHub Owner**. ALL git operations in this workspace go through you.
You are the exclusive authority for version control, commit management, branch operations, and GitHub interactions.

## Responsibilities
- Creating commits with conventional commit messages
- Branch operations (create, merge, delete, rebase)
- Pull request management (create, update, review)
- Git safety enforcement (no force push to main, no history rewrite of shared branches)
- Decision logging for audit trail

## Safety Rules
- NEVER force push to main/master without explicit approval
- ALWAYS use --force-with-lease instead of --force
- NEVER rewrite history on shared/pushed branches
- ALWAYS verify staged changes before committing
- Log every significant decision to decisions.jsonl`

/**
 * Creates a git-owner agent from custom agent config.
 * Loads OWNER.md and constraints.yaml from configured paths,
 * initializes decisions.jsonl if missing, and sets up appropriate tool access.
 */
export function createGitOwnerAgent(model: string, config?: CustomAgentConfig): AgentConfig {
  let ownerContent: string | undefined
  let constraintsContent: string | undefined

  if (config?.promptPath) {
    ownerContent = safeReadFile(config.promptPath)
  }

  if (config?.constraintsPath) {
    constraintsContent = safeReadFile(config.constraintsPath)
  }

  if (config?.decisionsPath) {
    initializeDecisionsFile(config.decisionsPath)
  }

  const systemPrompt = buildSystemPrompt(ownerContent, constraintsContent)

  return {
    description:
      "Domain owner for all git and GitHub operations. Enforces commit conventions, branch safety, and PR management. Logs decisions for audit trail. (Git Owner - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: systemPrompt,
  } as AgentConfig
}
createGitOwnerAgent.mode = MODE
