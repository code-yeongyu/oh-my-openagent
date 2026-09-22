import type { PluginInput } from "@opencode-ai/plugin"
import type { VerificationReminderConfig } from "../../config/schema/verification-reminder"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"

const DEFAULT_EDIT_WRITE_TOOLS = new Set(["edit", "write", "hashline_edit", "apply_patch", "multi_edit", "notepad_edit"])

const DEFAULT_VERIFICATION_PROMPT = `You edited files but never asked the user to verify.
Do NOT end your turn yet.

Use the question tool to ask the user:
{
  "questions": [{
    "question": "Do you want to verify alignment with the original request?",
    "header": "Verification",
    "options": [
      {"label": "Yes, verify alignment", "description": "Spawn a deep agent to check changes match the original request"},
      {"label": "No, continue", "description": "Skip verification and continue"}
    ]
  }]
}

If the user selects "Yes, verify alignment", spawn: task(category="deep", load_skills=["verify-alignment"], prompt="Verify the original request against the changes made")
If the user selects "No, continue", mark verification as complete and continue.`

export function createVerificationReminderHook(
  ctx: PluginInput,
  config?: VerificationReminderConfig,
) {
  const trackedTools = config?.tracked_tools
    ? new Set(config.tracked_tools.map((t) => t.toLowerCase()))
    : DEFAULT_EDIT_WRITE_TOOLS
  const verificationPrompt = config?.custom_prompt ?? DEFAULT_VERIFICATION_PROMPT
  const settleMs = config?.settle_ms ?? 150
  const editedSessions = new Map<string, boolean>()
  const promptDispatched = new Map<string, boolean>()
  const inFlight = new Set<string>()

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      _output: { title: string; output: string; metadata: unknown },
    ) => {
      const tool = input.tool.toLowerCase()
      if (trackedTools.has(tool)) {
        editedSessions.set(input.sessionID, true)
        promptDispatched.set(input.sessionID, false)
      }
    },

    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const sessionID = (event.properties as { sessionID?: string } | undefined)?.sessionID
      if (!sessionID) return
      if (event.type === "session.deleted") {
        editedSessions.delete(sessionID)
        promptDispatched.delete(sessionID)
        return
      }
      if (event.type !== "session.idle") return
      if (!editedSessions.get(sessionID) || promptDispatched.get(sessionID)) return
      if (inFlight.has(sessionID)) return
      inFlight.add(sessionID)
      try {
        const result = await dispatchInternalPrompt({
          mode: "async",
          client: ctx.client,
          sessionID,
          source: "verification-reminder:idle-gate",
          settleMs,
          queueBehavior: "defer",
          input: {
            path: { id: sessionID },
            body: { parts: [{ type: "text", text: verificationPrompt }] },
          },
        })
        if (result.status === "failed" && !isInternalPromptDispatchAccepted(result)) {
          console.warn("[verification-reminder] dispatch failed", result.error)
        }
        promptDispatched.set(sessionID, true)
      } finally {
        inFlight.delete(sessionID)
      }
    },
  }
}
