import type { PluginInput } from "@opencode-ai/plugin"
import type { 
  KimiReviewConfig, 
  KimiReviewOptions, 
  KimiReviewResult, 
  ReviewIssue, 
  ReviewSeverity,
  ToolExecuteInput,
  ToolExecuteOutput 
} from "./types"
import { 
  DEFAULT_CONFIG, 
  TRIGGER_TOOLS, 
  REVIEW_PROMPT_TEMPLATE,
  APPROVED_RESPONSE,
  buildReviewBlockMessage 
} from "./constants"
import { log, promptWithModelSuggestionRetry } from "../../shared"
import { minimatch } from "minimatch"
import { extname } from "node:path"

const KIMI_REVIEWER_AGENT = "kimi-reviewer"

export function parseReviewResponse(response: string): KimiReviewResult {
  const lines = response.split("\n")
  const issues: ReviewIssue[] = []
  let verdict: "APPROVED" | "ISSUES_FOUND" = "APPROVED"
  let currentSeverity: ReviewSeverity | null = null
  let currentIssueLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("REVIEW:")) {
      const verdictMatch = trimmed.match(/REVIEW:\s*(APPROVED|ISSUES_FOUND)/i)
      if (verdictMatch) {
        verdict = verdictMatch[1].toUpperCase() as "APPROVED" | "ISSUES_FOUND"
      }
      continue
    }

    const severityMatch = trimmed.match(/^\[(CRITICAL|WARNING|STYLE)\]$/)
    if (severityMatch) {
      if (currentSeverity && currentIssueLines.length > 0) {
        issues.push(createIssue(currentSeverity, currentIssueLines))
      }
      currentSeverity = severityMatch[1] as ReviewSeverity
      currentIssueLines = []
      continue
    }

    if (currentSeverity && trimmed.startsWith("-")) {
      if (currentIssueLines.length > 0) {
        issues.push(createIssue(currentSeverity, currentIssueLines))
      }
      currentIssueLines = [trimmed.slice(1).trim()]
    } else if (currentSeverity && trimmed && currentIssueLines.length > 0) {
      currentIssueLines.push(trimmed)
    }
  }

  if (currentSeverity && currentIssueLines.length > 0) {
    issues.push(createIssue(currentSeverity, currentIssueLines))
  }

  return {
    verdict,
    issues,
    summary: verdict === "APPROVED" 
      ? "No issues found." 
      : `Found ${issues.length} issue(s).`,
    rawResponse: response,
  }
}

function createIssue(severity: ReviewSeverity, lines: string[]): ReviewIssue {
  const message = lines[0] ?? ""
  let file: string | undefined
  let line: number | undefined
  let suggestion: string | undefined

  for (const l of lines.slice(1)) {
    if (l.startsWith("File:")) {
      const match = l.match(/File:\s*(.+?)(?::(\d+))?$/)
      if (match) {
        file = match[1].trim()
        line = match[2] ? parseInt(match[2], 10) : undefined
      }
    } else if (l.startsWith("Fix:") || l.startsWith("Suggestion:")) {
      suggestion = l.replace(/^(Fix|Suggestion):\s*/, "").trim()
    }
  }

  return { severity, message, file, line, suggestion }
}

function shouldReviewFile(
  filePath: string, 
  config: Required<KimiReviewConfig>
): boolean {
  for (const pattern of config.ignorePatterns) {
    if (minimatch(filePath, pattern)) {
      return false
    }
  }

  if (config.reviewThreshold === "all") {
    return true
  }

  const ext = extname(filePath)
  const extensions = new Set(config.extensions)
  return extensions.has(ext)
}

function extractFilePath(output: ToolExecuteOutput): string | undefined {
  const metadata = output.metadata as Record<string, unknown> | undefined
  
  if (metadata?.filePath && typeof metadata.filePath === "string") {
    return metadata.filePath
  }
  if (metadata?.file_path && typeof metadata.file_path === "string") {
    return metadata.file_path
  }
  
  const outputText = output.output
  const writeMatch = outputText.match(/(?:Wrote|Edited|Created)\s+(?:file\s+)?['"]?([^\s'"]+)['"]?/i)
  if (writeMatch) {
    return writeMatch[1]
  }

  return undefined
}

function buildReviewPrompt(
  filePath: string,
  operation: string,
  content?: string,
  oldContent?: string,
  newContent?: string,
  sessionContext?: string
): string {
  let prompt = REVIEW_PROMPT_TEMPLATE
    .replace("{{filePath}}", filePath)
    .replace("{{operation}}", operation)

  if (oldContent) {
    prompt = prompt.replace("{{#if oldContent}}", "").replace("{{/if}}", "")
    prompt = prompt.replace("{{oldContent}}", oldContent)
  } else {
    prompt = prompt.replace(/\{\{#if oldContent\}\}[\s\S]*?\{\{\/if\}\}/g, "")
  }

  if (newContent) {
    prompt = prompt.replace("{{#if newContent}}", "").replace("{{/if}}", "")
    prompt = prompt.replace("{{newContent}}", newContent)
  } else {
    prompt = prompt.replace(/\{\{#if newContent\}\}[\s\S]*?\{\{\/if\}\}/g, "")
  }

  if (content) {
    prompt = prompt.replace("{{#if content}}", "").replace("{{/if}}", "")
    prompt = prompt.replace("{{content}}", content)
  } else {
    prompt = prompt.replace(/\{\{#if content\}\}[\s\S]*?\{\{\/if\}\}/g, "")
  }

  if (sessionContext) {
    prompt += `\n\n${sessionContext}`
  }

  return prompt
}

function formatReviewOutput(result: KimiReviewResult): string {
  if (result.verdict === "APPROVED") {
    return APPROVED_RESPONSE
  }

  const lines = [`[KIMI REVIEW] ISSUES_FOUND - ${result.summary}`]
  
  const criticals = result.issues.filter(i => i.severity === "CRITICAL")
  const warnings = result.issues.filter(i => i.severity === "WARNING")
  const styles = result.issues.filter(i => i.severity === "STYLE")

  if (criticals.length > 0) {
    lines.push("\n[CRITICAL]")
    for (const issue of criticals) {
      lines.push(`- ${issue.message}`)
      if (issue.file) lines.push(`  File: ${issue.file}${issue.line ? `:${issue.line}` : ""}`)
      if (issue.suggestion) lines.push(`  Fix: ${issue.suggestion}`)
    }
  }

  if (warnings.length > 0) {
    lines.push("\n[WARNING]")
    for (const issue of warnings) {
      lines.push(`- ${issue.message}`)
      if (issue.suggestion) lines.push(`  Suggestion: ${issue.suggestion}`)
    }
  }

  if (styles.length > 0) {
    lines.push("\n[STYLE]")
    for (const issue of styles) {
      lines.push(`- ${issue.message}`)
    }
  }

  return lines.join("\n")
}

async function fetchSessionContext(
  ctx: PluginInput,
  sessionID: string,
  maxMessages = 10
): Promise<string> {
  try {
    const messagesResult = await ctx.client.session.messages({
      path: { id: sessionID },
    })

    if (messagesResult.error || !messagesResult.data) {
      return ""
    }

    const messages = messagesResult.data
      .slice(-maxMessages)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((m: any) => m.info.role === "user" || m.info.role === "assistant")

    if (messages.length === 0) {
      return ""
    }

    const contextLines: string[] = ["## Session Context (recent conversation)"]
    
    for (const msg of messages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const role = (msg as any).info.role === "user" ? "User" : "Assistant"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textParts = (msg as any).parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((p: any) => p.type === "text")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => p.text)
        .join("\n")
      
      if (textParts) {
        const truncated = textParts.length > 500 
          ? textParts.slice(0, 500) + "..." 
          : textParts
        contextLines.push(`\n**${role}**: ${truncated}`)
      }
    }

    return contextLines.join("\n")
  } catch (error) {
    log(`[kimi-auto-review] Failed to fetch session context: ${error}`)
    return ""
  }
}

async function invokeKimiReview(
  ctx: PluginInput,
  parentSessionID: string,
  reviewPrompt: string,
  config: Required<KimiReviewConfig>
): Promise<KimiReviewResult> {
  const parentSession = await ctx.client.session.get({
    path: { id: parentSessionID },
  }).catch(() => null)
  const parentDirectory = parentSession?.data?.directory ?? ctx.directory

  const createResult = await ctx.client.session.create({
    body: {
      parentID: parentSessionID,
      title: `kimi-review: code review`,
      permission: [
        { permission: "question", action: "deny" as const, pattern: "*" },
      ],
    } as any,
    query: {
      directory: parentDirectory,
    },
  })

  if (createResult.error) {
    log(`[kimi-auto-review] Session create error:`, createResult.error)
    throw new Error(`Failed to create review session: ${createResult.error}`)
  }

  const sessionID = createResult.data.id
  log(`[kimi-auto-review] Created review session: ${sessionID}`)

  let agentModel: { providerID: string; modelID: string } | undefined
  if (config.model) {
    const modelParts = config.model.split("/")
    if (modelParts.length >= 2) {
      agentModel = {
        providerID: modelParts[0],
        modelID: modelParts.slice(1).join("/"),
      }
      log(`[kimi-auto-review] Using model: ${config.model}`)
    }
  }

  const promptPromise = promptWithModelSuggestionRetry(ctx.client, {
    path: { id: sessionID },
    body: {
      agent: KIMI_REVIEWER_AGENT,
      tools: {
        task: false,
        call_omo_agent: false,
        look_at: false,
        read: true,
        glob: true,
        grep: true,
      },
      parts: [{ type: "text", text: reviewPrompt }],
      ...(agentModel ? { model: { providerID: agentModel.providerID, modelID: agentModel.modelID } } : {}),
    },
  })

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Review timed out after ${config.timeoutMs}ms`)), config.timeoutMs)
  })

  await Promise.race([promptPromise, timeoutPromise])

  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionID },
  })

  if (messagesResult.error) {
    log(`[kimi-auto-review] Messages error:`, messagesResult.error)
    throw new Error(`Failed to get review messages: ${messagesResult.error}`)
  }

  const messages = messagesResult.data
  log(`[kimi-auto-review] Got ${messages.length} messages from review session`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastAssistantMessage = messages
    .filter((m: any) => m.info.role === "assistant")
    .sort((a: any, b: any) => (b.info.time?.created || 0) - (a.info.time?.created || 0))[0]

  if (!lastAssistantMessage) {
    log(`[kimi-auto-review] No assistant message found in review session`)
    return {
      verdict: "APPROVED",
      issues: [],
      summary: "Review agent did not respond.",
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textParts = lastAssistantMessage.parts.filter((p: any) => p.type === "text")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responseText = textParts.map((p: any) => p.text).join("\n")

  log(`[kimi-auto-review] Got review response, length: ${responseText.length}`)

  return parseReviewResponse(responseText)
}

export function createKimiAutoReviewHook(
  ctx: PluginInput,
  options?: KimiReviewOptions
) {
  const config: Required<KimiReviewConfig> = {
    ...DEFAULT_CONFIG,
    ...options?.config,
    extensions: options?.config?.extensions ?? DEFAULT_CONFIG.extensions,
    ignorePatterns: options?.config?.ignorePatterns ?? DEFAULT_CONFIG.ignorePatterns,
  }

  return {
    "tool.execute.after": async (
      input: ToolExecuteInput,
      output: ToolExecuteOutput
    ): Promise<{ block?: boolean; reason?: string } | void> => {
      if (!config.enabled) {
        return
      }

      const toolLower = input.tool.toLowerCase()
      if (!TRIGGER_TOOLS.includes(toolLower as typeof TRIGGER_TOOLS[number])) {
        return
      }

      const filePath = extractFilePath(output)
      if (!filePath) {
        log("[kimi-auto-review] Could not extract file path from output")
        return
      }

      if (!shouldReviewFile(filePath, config)) {
        log(`[kimi-auto-review] Skipping non-code file: ${filePath}`)
        return
      }

      try {
        const operation = toolLower === "write" ? "Write (create/overwrite)" : "Edit (modify)"
        
        const sessionContext = await fetchSessionContext(ctx, input.sessionID)
        const reviewPrompt = buildReviewPrompt(filePath, operation, undefined, undefined, undefined, sessionContext)

        log(`[kimi-auto-review] Invoking review for: ${filePath}`)
        const reviewResult = await invokeKimiReview(ctx, input.sessionID, reviewPrompt, config)

        const reviewOutput = formatReviewOutput(reviewResult)
        output.output += `\n\n${reviewOutput}`

        if (config.blockOnCritical && reviewResult.issues.some(i => i.severity === "CRITICAL")) {
          const criticalMessages = reviewResult.issues
            .filter(i => i.severity === "CRITICAL")
            .map(i => `- ${i.message}`)
          
          return {
            block: true,
            reason: buildReviewBlockMessage(criticalMessages),
          }
        }
      } catch (err) {
        log(`[kimi-auto-review] Error invoking review: ${err}`)
        // Don't block on review errors - fail open
      }
    },
  }
}
