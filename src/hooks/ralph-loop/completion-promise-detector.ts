import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { withTimeout } from "./with-timeout"

interface OpenCodeSessionMessage {
  info?: { role?: string }
  parts?: Array<{ type: string; text?: string }>
}

type TranscriptEntry = Record<string, unknown> & { type?: string }

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildPromisePattern(promise: string): RegExp {
  return new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
}

function readTranscriptEntries(transcriptPath: string | undefined): TranscriptEntry[] {
  if (!transcriptPath || !existsSync(transcriptPath)) return []
  try {
    const content = readFileSync(transcriptPath, "utf-8")
    const lines = content.split("\n").filter((line) => line.trim())
    const entries: TranscriptEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as TranscriptEntry)
      } catch {
        continue
      }
    }
    return entries
  } catch {
    return []
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractTextFromTranscriptEntry(entry: TranscriptEntry): string {
  const chunks: string[] = []
  if (typeof entry.content === "string") chunks.push(entry.content)
  if (typeof entry.text === "string") chunks.push(entry.text)
  if (typeof entry.output === "string") chunks.push(entry.output)

  const info = entry.info as Record<string, unknown> | undefined
  if (info && typeof info.text === "string") chunks.push(info.text)

  if (Array.isArray(entry.parts)) {
    for (const part of entry.parts) {
      if (typeof part !== "object" || part === null) continue
      const rec = part as Record<string, unknown>
      if (typeof rec.text === "string") chunks.push(rec.text)
    }
  }

  if ("tool_output" in entry) {
    const toolOutput = entry.tool_output as Record<string, unknown> | string | undefined
    if (
      typeof toolOutput === "object" &&
      toolOutput !== null &&
      typeof toolOutput.output === "string"
    ) {
      chunks.push(toolOutput.output)
    } else {
      chunks.push(stringifyUnknown(entry.tool_output))
    }
  }
  return chunks.filter(Boolean).join("\n")
}

function lineHasPass(lines: string[], pattern: RegExp): boolean {
  return lines.some(
    (line) => pattern.test(line) && /(pass|passed|success|succeeded|ok)/i.test(line),
  )
}

function countNextCycleTargets(lines: string[]): number {
  const start = lines.findIndex((line) => /next-cycle targets/i.test(line))
  if (start < 0) return 0
  let count = 0
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    if (/^[A-Z][A-Za-z ]+:/.test(line)) break
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) count += 1
  }
  return count
}

export function getLatestNonUserTranscriptText(transcriptPath: string | undefined): string | null {
  const entries = readTranscriptEntries(transcriptPath)
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.type === "user") continue
    const text = extractTextFromTranscriptEntry(entry)
    if (text.trim()) return text
  }
  return null
}

export function evaluateAuditCompletionLock(transcriptPath: string | undefined): {
  passed: boolean
  missing: string[]
} {
  const latestText = getLatestNonUserTranscriptText(transcriptPath)
  if (!latestText) {
    return { passed: false, missing: ["evidence text missing"] }
  }

  const lines = latestText.split(/\r?\n/).map((line) => line.trim())
  const missing: string[] = []

  if (!/gate status/i.test(latestText)) missing.push("Gate Status table")

  const gates = [
    { name: "Scope Coverage", pattern: /scope coverage/i },
    { name: "Issue Closure", pattern: /issue closure/i },
    { name: "Validation", pattern: /validation/i },
    { name: "Accessibility", pattern: /(accessibility|a11y)/i },
    { name: "Re-Audit", pattern: /re[- ]?audit/i },
    { name: "Skill Coverage", pattern: /skill coverage/i },
    { name: "Evidence", pattern: /evidence/i },
  ]
  for (const gate of gates) {
    if (!lineHasPass(lines, gate.pattern)) missing.push(`${gate.name} PASS`)
  }

  const analyzePassed = lineHasPass(lines, /(analyze|lint)/i)
  const testPassed = lineHasPass(lines, /\btest(s)?\b/i)
  const buildPassed = lineHasPass(lines, /\bbuild\b/i)
  if (!analyzePassed || !testPassed || !buildPassed) {
    missing.push("deterministic validator pipeline (analyze/test/build PASS)")
  }

  if (!lineHasPass(lines, /regression scan/i)) missing.push("Regression Scan PASS")

  const keyboardPassed = lineHasPass(lines, /keyboard/i)
  const focusPassed = lineHasPass(lines, /\bfocus\b/i)
  const semanticsPassed = lineHasPass(lines, /(semantics|labels)/i)
  const contrastPassed = lineHasPass(lines, /contrast/i)
  if (!keyboardPassed || !focusPassed || !semanticsPassed || !contrastPassed) {
    missing.push("A11y checklist PASS (keyboard/focus/semantics/contrast)")
  }

  const testDeltaPassed =
    lineHasPass(lines, /test delta/i) ||
    lines.some((line) => /(added|updated).*(test|tests)/i.test(line)) ||
    lines.some((line) => /(\.test\.|_test\.)/.test(line))
  if (!testDeltaPassed) missing.push("Test Delta PASS")

  const highRiskLine = lines.find((line) => /high[- ]?risk refactors?/i.test(line))
  if (highRiskLine) {
    const match = highRiskLine.match(/(\d+)/)
    const count = match ? Number(match[1]) : 0
    if (Number.isFinite(count) && count > 1) {
      missing.push("Risk budget (high-risk refactors <= 1)")
    }
  } else {
    missing.push("Risk budget evidence")
  }

  if (countNextCycleTargets(lines) > 3) {
    missing.push("Objective cap (<= 3 next-cycle targets)")
  }

  if (!/focus screen/i.test(latestText)) missing.push("Focus Screen evidence")
  if (!/files changed/i.test(latestText)) missing.push("Files Changed evidence")
  if (!/required skills/i.test(latestText) || !/skills used/i.test(latestText)) {
    missing.push("Required Skills evidence (Required Skills + Skills Used)")
  }

  const structural = lines.some((line) => /(structural refactor|refactor)/i.test(line))
  const a11yOrUx = lines.some((line) => /(a11y|accessibility|ux)/i.test(line))
  const cosmeticOnlySignals = lines.some((line) => /(visual|cosmetic|styling)/i.test(line))
  if (cosmeticOnlySignals && !structural && !a11yOrUx) {
    missing.push("No cosmetic-only cycle")
  }

  return { passed: missing.length === 0, missing }
}

function extractStagnationFingerprint(text: string): string | null {
  const lines = text.split(/\r?\n/)
  const focus = lines.find((line) => /focus screen/i.test(line)) ?? ""
  const files = lines.find((line) => /files changed/i.test(line)) ?? ""
  const nextTargets = lines.find((line) => /next-cycle targets/i.test(line)) ?? ""
  const fingerprint = [focus, files, nextTargets]
    .map((line) => line.toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ")
  return fingerprint || null
}

export function detectAuditCycleStagnation(transcriptPath: string | undefined): boolean {
  const entries = readTranscriptEntries(transcriptPath)
  const fingerprints: string[] = []
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.type === "user") continue
    const text = extractTextFromTranscriptEntry(entry)
    if (!/files changed/i.test(text) || !/next-cycle targets/i.test(text)) continue
    const fingerprint = extractStagnationFingerprint(text)
    if (fingerprint) fingerprints.push(fingerprint)
    if (fingerprints.length >= 2) break
  }
  if (fingerprints.length < 2) return false
  return fingerprints[0] === fingerprints[1]
}

export function detectCompletionInTranscript(
  transcriptPath: string | undefined,
  promise: string,
): boolean {
  if (!transcriptPath || !existsSync(transcriptPath)) return false
  try {
    const pattern = buildPromisePattern(promise)
    const lines = readFileSync(transcriptPath, "utf-8").split("\n").filter((line) => line.trim())
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { type?: string }
        if (entry.type === "user") continue
        if (pattern.test(line)) return true
      } catch {
        continue
      }
    }
    return false
  } catch {
    return false
  }
}

export async function detectCompletionInSessionMessages(
  ctx: PluginInput,
  options: {
    sessionID: string
    promise: string
    apiTimeoutMs: number
    directory: string
  },
): Promise<boolean> {
  try {
    const response = await withTimeout(
      ctx.client.session.messages({
        path: { id: options.sessionID },
        query: { directory: options.directory },
      }),
      options.apiTimeoutMs,
    )

    const responseData =
      typeof response === "object" && response !== null && "data" in response
        ? (response as { data?: unknown }).data
        : undefined

    const messageArray: unknown[] = Array.isArray(response)
      ? response
      : Array.isArray(responseData)
        ? responseData
        : []

    const assistantMessages = (messageArray as OpenCodeSessionMessage[]).filter(
      (msg) => msg.info?.role === "assistant",
    )
    if (assistantMessages.length === 0) return false

    const pattern = buildPromisePattern(options.promise)
    const recentAssistants = assistantMessages.slice(-3)
    for (const assistant of recentAssistants) {
      if (!assistant.parts) continue
      let responseText = ""
      for (const part of assistant.parts) {
        if (part.type !== "text") continue
        responseText += `${responseText ? "\n" : ""}${part.text ?? ""}`
      }
      if (pattern.test(responseText)) return true
    }

    return false
  } catch (err) {
    setTimeout(() => {
      log(`[${HOOK_NAME}] Session messages check failed`, {
        sessionID: options.sessionID,
        error: String(err),
      })
    }, 0)
    return false
  }
}
