import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask } from "./types"
import {
  log,
  getAgentToolRestrictions,
  createInternalAgentTextPart,
} from "../../shared"
import { setSessionTools } from "../../shared/session-tools-store"

type OpencodeClient = PluginInput["client"]

const CONTINUATION_PROMPT =
  "Your session was compacted (context summarized). Continue your analysis from where you left off. Report your findings when done."

export function sendPostCompactionContinuation(
  client: OpencodeClient,
  task: BackgroundTask,
  sessionID: string,
): void {
  if (task.status !== "running") return

  const resumeModel = task.model
    ? { providerID: task.model.providerID, modelID: task.model.modelID }
    : undefined
  const resumeVariant = task.model?.variant

  client.session.promptAsync({
    path: { id: sessionID },
    body: {
      agent: task.agent,
      ...(resumeModel ? { model: resumeModel } : {}),
      ...(resumeVariant ? { variant: resumeVariant } : {}),
      tools: (() => {
        const tools = {
          task: false,
          call_omo_agent: true,
          question: false,
          ...getAgentToolRestrictions(task.agent),
        }
        setSessionTools(sessionID, tools)
        return tools
      })(),
      parts: [createInternalAgentTextPart(CONTINUATION_PROMPT)],
    },
  }).catch((error) => {
    log("[background-agent] Post-compaction continuation error:", {
      taskId: task.id,
      error: String(error),
    })
  })

  if (task.progress) {
    task.progress.lastUpdate = new Date()
  }
}
