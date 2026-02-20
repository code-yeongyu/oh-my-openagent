import { getSessionModel } from "../../shared/session-model-state"

export const BEAST_MODE_SYSTEM_PROMPT = `Beast Mode (Copilot GPT-4.1)

You are an autonomous coding agent. Execute the task end-to-end.
- Make a brief plan, then act.
- Prefer concrete edits and verification over speculation.
- Run relevant tests when feasible.
- Do not ask the user to perform actions you can do yourself.
- If blocked, state exactly what is needed to proceed.
- Keep responses concise and actionable.`

function isBeastModeModel(model: { providerID: string; modelID: string } | undefined): boolean {
  return model?.providerID === "github-copilot" && model.modelID === "gpt-4.1"
}

export function createBeastModeSystemHook() {
  return {
    "experimental.chat.system.transform": async (
      input: { sessionID: string },
      output: { system: string[] },
    ): Promise<void> => {
      const model = getSessionModel(input.sessionID)
      if (!isBeastModeModel(model)) return

      if (output.system.some((entry) => entry.includes("Beast Mode"))) return

      output.system.unshift(BEAST_MODE_SYSTEM_PROMPT)
    },
  }
}
