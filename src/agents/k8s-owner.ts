import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import type { CustomAgentConfig } from "../config/schema"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { dirname, resolve } from "path"
import { homedir } from "os"

const MODE: AgentMode = "subagent"

export const K8S_OWNER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Kubernetes Owner",
  triggers: [
    { domain: "Kubernetes operations", trigger: "Any kubectl scale, delete, apply, or context switch" },
    { domain: "Multi-cluster management", trigger: "Context switching between clusters" },
    { domain: "Auto-scaling safety", trigger: "Operations that may conflict with KEDA/HPA" },
  ],
  useWhen: [
    "Scaling deployments (check KEDA/HPA first)",
    "Switching cluster contexts",
    "Deleting Kubernetes resources",
    "Applying manifests",
    "Enforcing multi-cluster safety",
  ],
  avoidWhen: [
    "Reading kubectl output (use bash directly)",
    "Code implementation (use coding agents)",
    "Non-kubectl operations",
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
  knowledgeContents: string[] = [],
): string {
  const parts: string[] = []

  if (ownerContent) {
    parts.push(ownerContent)
  } else {
    parts.push(DEFAULT_K8S_OWNER_PROMPT)
  }

  if (constraintsContent) {
    parts.push(`\n\n## Constraints Reference (Machine-Readable)\n\n\`\`\`yaml\n${constraintsContent}\n\`\`\``)
  }

  for (const knowledgeContent of knowledgeContents) {
    parts.push(`\n\n---\n## Company Conventions\n\n${knowledgeContent}`)
  }

  return parts.join("\n")
}

const DEFAULT_K8S_OWNER_PROMPT = `# Kubernetes & kubectl Owner

You are the **Kubernetes & kubectl Owner**. ALL kubectl operations in this workspace go through you.
You are the exclusive authority for Kubernetes cluster operations, resource management, context switching, and multi-cluster safety.

## Responsibilities
- Executing kubectl operations with proper safety checks
- Context switching between clusters with confirmation
- Scaling deployments (checking for KEDA/HPA conflicts)
- Deleting Kubernetes resources with verification
- Applying manifests with validation
- Enforcing multi-cluster safety
- Decision logging for audit trail

## Safety Rules
- NEVER switch context without showing current context first
- ALWAYS check for KEDA ScaledObject or HPA before scaling
- NEVER delete resources without explicit confirmation
- ALWAYS require extra confirmation for production clusters
- ALWAYS verify cluster context before operations
- Log every significant decision to decisions.jsonl`

/**
 * Creates a kubernetes-owner agent from custom agent config.
 * Loads OWNER.md and constraints.yaml from configured paths,
 * initializes decisions.jsonl if missing, and sets up appropriate tool access.
 */
export function createK8sOwnerAgent(model: string, config?: CustomAgentConfig): AgentConfig {
  let ownerContent: string | undefined
  let constraintsContent: string | undefined
  const knowledgeContents: string[] = []

  if (config?.promptPath) {
    ownerContent = safeReadFile(config.promptPath)
  }

  if (config?.constraintsPath) {
    constraintsContent = safeReadFile(config.constraintsPath)
  }

  if (config?.decisionsPath) {
    initializeDecisionsFile(config.decisionsPath)
  }

  if (config?.knowledgePaths && config.knowledgePaths.length > 0) {
    for (const knowledgePath of config.knowledgePaths) {
      const content = safeReadFile(knowledgePath)
      if (content) {
        knowledgeContents.push(content)
      }
    }
  }

  const systemPrompt = buildSystemPrompt(ownerContent, constraintsContent, knowledgeContents)

  return {
    description:
      "Domain owner for all kubectl and Kubernetes operations. Enforces cluster safety, context awareness, and auto-scaling checks. Logs decisions for audit trail. (Kubernetes Owner - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: systemPrompt,
  } as AgentConfig
}
createK8sOwnerAgent.mode = MODE
