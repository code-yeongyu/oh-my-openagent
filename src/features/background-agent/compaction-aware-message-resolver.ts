import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { StoredMessage } from "../hook-message-injector"
import { getCompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"

type SessionMessage = {
  info?: {
    agent?: string
    model?: {
      providerID?: string
      modelID?: string
      variant?: string
    }
    providerID?: string
    modelID?: string
    tools?: StoredMessage["tools"]
  }
}

export function isCompactionAgent(agent: string | undefined): boolean {
  return agent?.trim().toLowerCase() === "compaction"
}

function hasFullAgentAndModel(message: StoredMessage): boolean {
  return !!message.agent &&
    !isCompactionAgent(message.agent) &&
    !!message.model?.providerID &&
    !!message.model?.modelID
}

function hasPartialAgentOrModel(message: StoredMessage): boolean {
  const hasAgent = !!message.agent && !isCompactionAgent(message.agent)
  const hasModel = !!message.model?.providerID && !!message.model?.modelID
  return hasAgent || hasModel || !!message.tools
}

function convertSessionMessageToStoredMessage(message: SessionMessage): StoredMessage | null {
  const info = message.info
  if (!info) {
    return null
  }

  const providerID = info.model?.providerID ?? info.providerID
  const modelID = info.model?.modelID ?? info.modelID

  return {
    ...(info.agent ? { agent: info.agent } : {}),
    ...(providerID && modelID
      ? {
          model: {
            providerID,
            modelID,
            ...(info.model?.variant ? { variant: info.model.variant } : {}),
          },
        }
      : {}),
    ...(info.tools ? { tools: info.tools } : {}),
  }
}

function mergeStoredMessages(
  messages: Array<StoredMessage | null>,
  sessionID?: string,
): StoredMessage | null {
  const merged: StoredMessage = {}

  for (const message of messages) {
    if (!message || isCompactionAgent(message.agent)) {
      continue
    }

    if (!merged.agent && message.agent) {
      merged.agent = message.agent
    }

    if (!merged.model?.providerID && message.model?.providerID && message.model.modelID) {
      merged.model = {
        providerID: message.model.providerID,
        modelID: message.model.modelID,
        ...(message.model.variant ? { variant: message.model.variant } : {}),
      }
    }

    if (!merged.tools && message.tools) {
      merged.tools = message.tools
    }

    if (hasFullAgentAndModel(merged) && merged.tools) {
      break
    }
  }

  const checkpoint = sessionID
    ? getCompactionAgentConfigCheckpoint(sessionID)
    : undefined

  if (!merged.agent && checkpoint?.agent) {
    merged.agent = checkpoint.agent
  }

  if (!merged.model && checkpoint?.model) {
    merged.model = {
      providerID: checkpoint.model.providerID,
      modelID: checkpoint.model.modelID,
    }
  }

  if (!merged.tools && checkpoint?.tools) {
    merged.tools = checkpoint.tools
  }

  return hasPartialAgentOrModel(merged) ? merged : null
}

export function resolvePromptContextFromSessionMessages(
  messages: SessionMessage[],
  sessionID?: string,
): StoredMessage | null {
  const convertedMessages = messages
    .map(convertSessionMessageToStoredMessage)
    .reverse()

  return mergeStoredMessages(convertedMessages, sessionID)
}

export function findNearestMessageExcludingCompaction(
  messageDir: string,
  sessionID?: string,
): StoredMessage | null {
  try {
    const files = readdirSync(messageDir)
      .filter((name: string) => name.endsWith(".json"))
      .sort()
      .reverse()

    const messages: Array<StoredMessage | null> = []

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        messages.push(JSON.parse(content) as StoredMessage)
      } catch {
        continue
      }
    }

    return mergeStoredMessages(messages, sessionID)
  } catch {
    return null
  }
}
