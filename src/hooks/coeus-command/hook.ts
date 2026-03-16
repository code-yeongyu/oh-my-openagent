import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { COEUS_SESSION_TAG, HOOK_NAME, PLANS_DIR } from "./constants"
import { findBriefBySlug, findLatestBrief } from "./brief-detector"
import { buildCoeusContext, type CoeusSessionState } from "./state-injector"
import { log } from "../../shared/logger"

interface CoeusHookInput {
  sessionID: string
}

interface CoeusHookOutput {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string }>
}

function extractSlug(text: string): string | null {
  const match = text.match(/<user-request\s+slug="([^"]+)"/)
  return match?.[1] ?? null
}

function hasExistingPlan(dir: string): boolean {
  const plansPath = join(dir, PLANS_DIR)
  if (!existsSync(plansPath)) return false
  const files = readdirSync(plansPath).filter((f) => f.endsWith(".md"))
  return files.length > 0
}

function determineState(dir: string, slug: string | null): { state: CoeusSessionState; briefPath?: string } {
  if (hasExistingPlan(dir)) {
    return { state: "plan-exists" }
  }

  const brief = slug ? findBriefBySlug(dir, slug) : findLatestBrief(dir)
  if (brief) {
    return { state: "brief-exists", briefPath: brief }
  }

  return { state: "fresh" }
}

export function createCoeusCommandHook(ctx: PluginInput) {
  return {
    "chat.message": async (input: CoeusHookInput, output: CoeusHookOutput): Promise<void> => {
      const promptText =
        output.parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || ""

      if (!promptText.includes(COEUS_SESSION_TAG)) return

      log(`[${HOOK_NAME}] Processing coeus-session tag`, { sessionID: input.sessionID })

      const slug = extractSlug(promptText)
      const { state, briefPath } = determineState(ctx.directory, slug)
      const context = buildCoeusContext(state, briefPath)

      const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
      if (idx >= 0 && output.parts[idx].text) {
        output.parts[idx].text += `\n\n---\n${context}`
      }

      log(`[${HOOK_NAME}] Context injected`, { sessionID: input.sessionID, state, slug })
    },
  }
}
