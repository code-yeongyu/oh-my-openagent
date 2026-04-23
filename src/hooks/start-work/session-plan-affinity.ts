import { isAbsolute, resolve } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"

const PLAN_PATH_PATTERN = /[A-Za-z0-9_./\\:-]*\.sisyphus[\\/]plans[\\/][A-Za-z0-9._/\\-]+\.md/gi

interface SessionMessagePart {
  text?: string
  output?: string
  input?: Record<string, unknown>
}

interface SessionMessage {
  parts?: SessionMessagePart[]
}

function normalizePlanPath(directory: string, candidate: string): string {
  const trimmedCandidate = candidate.trim().replace(/^["'`]+|["'`]+$/g, "")
  if (isAbsolute(trimmedCandidate) || /^[A-Za-z]:[\\/]/.test(trimmedCandidate)) {
    return resolve(trimmedCandidate)
  }

  return resolve(directory, trimmedCandidate)
}

function extractPlanPathsFromText(directory: string, text: string): string[] {
  const matches = text.match(PLAN_PATH_PATTERN) ?? []
  return matches.map((match) => normalizePlanPath(directory, match))
}

function extractPlanPathsFromInput(directory: string, input: Record<string, unknown> | undefined): string[] {
  if (!input) {
    return []
  }

  const directCandidates = [input.filePath, input.path, input.file]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => extractPlanPathsFromText(directory, value))

  if (directCandidates.length > 0) {
    return directCandidates
  }

  return extractPlanPathsFromText(directory, JSON.stringify(input))
}

export async function findRecentSessionPlanPath(input: {
  client: PluginInput["client"]
  directory: string
  sessionID: string
  availablePlans: string[]
}): Promise<string | null> {
  if (typeof input.client.session?.messages !== "function") {
    return null
  }

  const availablePlans = new Set(input.availablePlans.map((planPath) => resolve(planPath)))
  if (availablePlans.size === 0) {
    return null
  }

  try {
    const response = await input.client.session.messages({ path: { id: input.sessionID } })
    const messages = normalizeSDKResponse(response, [] as SessionMessage[])

    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const parts = messages[messageIndex]?.parts ?? []

      for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = parts[partIndex]
        const planCandidates = [
          ...extractPlanPathsFromText(input.directory, part.text ?? ""),
          ...extractPlanPathsFromText(input.directory, part.output ?? ""),
          ...extractPlanPathsFromInput(input.directory, part.input),
        ]

        const matchedPlan = planCandidates.find((planPath) => availablePlans.has(resolve(planPath)))
        if (matchedPlan) {
          return resolve(matchedPlan)
        }
      }
    }
  } catch (error) {
    log("[start-work] Failed to inspect session history for preferred plan", {
      sessionID: input.sessionID,
      error: String(error),
    })
  }

  return null
}
