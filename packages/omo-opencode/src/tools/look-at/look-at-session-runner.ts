import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import {
  assertOpenCodeSpawnAdmission,
  requireSpawnCallerIdentity,
} from "../../features/background-agent/subagent-spawn-limits"
import { isAmbiguousPromptDispatchFailure, log, promptSyncWithModelSuggestionRetry } from "../../shared"
import { extractLatestAssistantText } from "./assistant-message-extractor"
import { MULTIMODAL_LOOKER_AGENT } from "./constants"
import { READ_ENABLED, buildLookAtPrompt } from "./look-at-prompt"
import type { LookAtFilePart, LookAtInputPart } from "./look-at-input-preparer"
import { resolveMultimodalLookerAgentMetadata } from "./multimodal-agent-metadata"
import { waitForLookAtSessionResult } from "./session-poller"
import type { LookAtSpawnAdmissionConfig } from "./tools"

interface RunLookAtSessionInput {
  ctx: PluginInput
  toolContext: ToolContext
  goal: string
  inputParts: LookAtInputPart[]
  spawnAdmissionConfig: LookAtSpawnAdmissionConfig
}

export async function runLookAtSession({
  ctx,
  toolContext,
  goal,
  inputParts,
  spawnAdmissionConfig,
}: RunLookAtSessionInput): Promise<string> {
  const fileParts = inputParts.filter((part): part is LookAtFilePart => part.type === "file")
  const prompt = buildLookAtPrompt(goal, fileParts)
  await assertOpenCodeSpawnAdmission({
    client: ctx.client,
    directory: ctx.directory,
    config: spawnAdmissionConfig.backgroundTaskConfig,
    agentOverrides: spawnAdmissionConfig.agentOverrides,
    teamModeConfig: spawnAdmissionConfig.teamModeConfig,
    request: {
      parentSessionID: toolContext.sessionID,
      parentAgent: requireSpawnCallerIdentity(toolContext.agent),
      targetAgent: MULTIMODAL_LOOKER_AGENT,
    },
  })
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

  log(`[look_at] Sending prompt with ${fileParts.length} file(s) to session ${sessionID}`)
  let shouldWaitForStatus = true
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
          ...inputParts,
        ],
        ...(agentModel ? { model: { providerID: agentModel.providerID, modelID: agentModel.modelID } } : {}),
        ...(agentVariant ? { variant: agentVariant } : {}),
      },
    }, {
      queueBehavior: "defer",
    })
  } catch (promptError) {
    log("[look_at] Prompt dispatch failed; checking child session evidence:", promptError)
    shouldWaitForStatus = isAmbiguousPromptDispatchFailure(promptError)
  }

  let observedMessages: unknown[] | undefined
  let observedText: string | undefined
  if (shouldWaitForStatus && typeof ctx.client.session.status === "function") {
    const waitResult = await waitForLookAtSessionResult(ctx.client, sessionID, {
      allowStableIdleWithoutActivity: true,
    })
    observedText = waitResult.outcome.text ?? undefined
    if (observedText) {
      observedMessages = waitResult.messages
    }
  }

  let messages = observedMessages
  if (!messages) {
    log(`[look_at] Fetching messages from session ${sessionID}...`)
    const messagesResult = await ctx.client.session.messages({
      path: { id: sessionID },
    })

    if (messagesResult.error) {
      log("[look_at] Messages error:", messagesResult.error)
      return `Error: Failed to get messages: ${messagesResult.error}`
    }
    messages = messagesResult.data
  }
  log(`[look_at] Got ${messages.length} messages`)

  const responseText = observedText ?? extractLatestAssistantText(messages)
  if (!responseText) {
    log("[look_at] No assistant message found")
    return "Error: No response from multimodal-looker agent"
  }

  log(`[look_at] Got response, length: ${responseText.length}`)
  return responseText
}
