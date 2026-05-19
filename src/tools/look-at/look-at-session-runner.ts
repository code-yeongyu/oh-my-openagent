import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { log, promptSyncWithModelSuggestionRetry } from "../../shared"
import { extractLatestAssistantText } from "./assistant-message-extractor"
import { MULTIMODAL_LOOKER_AGENT } from "./constants"
import { READ_ENABLED, buildLookAtPrompt } from "./look-at-prompt"
import type { LookAtFilePart } from "./look-at-input-preparer"
import { resolveMultimodalLookerAgentMetadata } from "./multimodal-agent-metadata"

interface RunLookAtSessionInput {
  ctx: PluginInput
  toolContext: ToolContext
  goal: string
  filePart: LookAtFilePart
  isBase64Input: boolean
}

export async function runLookAtSession({
  ctx,
  toolContext,
  goal,
  filePart,
  isBase64Input,
}: RunLookAtSessionInput): Promise<string> {
  const prompt = buildLookAtPrompt(goal, isBase64Input)
  const { agentModel, agentVariant } = await resolveMultimodalLookerAgentMetadata(ctx)

  log(`[look_at] Creating session with parent: ${toolContext.sessionID}`)
  const parentSession = await ctx.client.session.get({
    path: { id: toolContext.sessionID },
  }).catch(() => null)
  const parentDirectory = parentSession?.data?.directory ?? ctx.directory

  const createResult = await ctx.client.session.create({
    body: {
      parentID: toolContext.sessionID,
      title: `look_at: ${goal.substring(0, 50)}`,
    },
    query: { directory: parentDirectory },
  })

  if (createResult.error) {
    log("[look_at] Session create error:", createResult.error)
    const errorString = String(createResult.error)
    if (errorString.toLowerCase().includes("unauthorized")) {
      return `Error: Failed to create session (Unauthorized). This may be due to:
1. OAuth token restrictions (e.g., Claude Code credentials are restricted to Claude Code only)
2. Provider authentication issues
3. Session permission inheritance problems

Try using a different provider or API key authentication.

Original error: ${createResult.error}`
    }

    return `Error: Failed to create session: ${createResult.error}`
  }

  const sessionID = createResult.data.id
  log(`[look_at] Created session: ${sessionID}`)

  log(`[look_at] Sending prompt with ${isBase64Input ? "base64 image" : "file"} to session ${sessionID}`)
  try {
    await promptSyncWithModelSuggestionRetry(ctx.client, {
      path: { id: sessionID },
      body: {
        agent: MULTIMODAL_LOOKER_AGENT,
        tools: {
          task: false,
          call_omo_agent: false,
          look_at: false,
          read: READ_ENABLED,
        },
        parts: [
          { type: "text", text: prompt },
          filePart,
        ],
        ...(agentModel ? { model: { providerID: agentModel.providerID, modelID: agentModel.modelID } } : {}),
        ...(agentVariant ? { variant: agentVariant } : {}),
      },
    })
  } catch (promptError) {
    log("[look_at] Prompt error (ignored, will still fetch messages):", promptError)
  }

  log(`[look_at] Fetching messages from session ${sessionID}...`)
  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionID },
  })

  if (messagesResult.error) {
    log("[look_at] Messages error:", messagesResult.error)
    return `Error: Failed to get messages: ${messagesResult.error}`
  }

  const messages = messagesResult.data
  log(`[look_at] Got ${messages.length} messages`)

  const responseText = extractLatestAssistantText(messages)
  if (!responseText) {
    log("[look_at] No assistant message found")
    return "Error: No response from multimodal-looker agent"
  }

  log(`[look_at] Got response, length: ${responseText.length}`)
  return responseText
}
