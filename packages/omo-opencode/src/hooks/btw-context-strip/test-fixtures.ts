import type { Message, Part } from "@opencode-ai/sdk"

export type MessageWithParts = {
  info: Message
  parts: Part[]
}

const SESSION_ID = "btw-fixture-session"
const CREATED_AT = 0
const AGENT = "fixture-agent"
const MODEL = {
  providerID: "fixture-provider",
  modelID: "fixture-model",
}

function buildUserInfo(id: string): Extract<Message, { role: "user" }> {
  return {
    id,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: CREATED_AT },
    agent: AGENT,
    model: MODEL,
  }
}

function buildAssistantInfo(id: string, parentID = "fixture-parent"): Extract<Message, { role: "assistant" }> {
  return {
    id,
    sessionID: SESSION_ID,
    role: "assistant",
    time: { created: CREATED_AT, completed: CREATED_AT },
    parentID,
    modelID: MODEL.modelID,
    providerID: MODEL.providerID,
    mode: "build",
    path: {
      cwd: "/fixture/project",
      root: "/fixture/project",
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: "stop",
  }
}

function buildTextPart(messageID: string, index: number, text: string): Part {
  return {
    id: `${messageID}_text_${index}`,
    sessionID: SESSION_ID,
    messageID,
    type: "text",
    text,
  }
}

function buildReasoningPart(messageID: string, text: string): Part {
  return {
    id: `${messageID}_reasoning_0`,
    sessionID: SESSION_ID,
    messageID,
    type: "reasoning",
    text,
    time: { start: CREATED_AT, end: CREATED_AT },
  }
}

function buildToolUsePart(messageID: string, toolName: string, toolId: string): Part {
  return {
    id: toolId,
    sessionID: SESSION_ID,
    messageID,
    type: "tool_use",
    name: toolName,
    input: {},
  } as unknown as Part
}

function buildToolResultPart(messageID: string, toolId: string): Part {
  return {
    id: `${toolId}_result`,
    sessionID: SESSION_ID,
    messageID,
    type: "tool_result",
    toolUseId: toolId,
    tool_use_id: toolId,
    content: [{ type: "text", text: "fixture tool result" }],
  } as unknown as Part
}

// Build a normal user message
export function buildUserMessage(content: string): MessageWithParts {
  const messageID = "user_message"

  return {
    info: buildUserInfo(messageID),
    parts: [buildTextPart(messageID, 0, content)],
  }
}

// Build a normal assistant message (single text part)
export function buildAssistantMessage(content: string): MessageWithParts {
  const messageID = "assistant_message"

  return {
    info: buildAssistantInfo(messageID),
    parts: [buildTextPart(messageID, 0, content)],
  }
}

// Build a multi-part assistant message (e.g. two text parts)
export function buildMultiPartAssistantMessage(parts: string[]): MessageWithParts {
  const messageID = "assistant_multipart_message"

  return {
    info: buildAssistantInfo(messageID),
    parts: parts.map((part, index) => buildTextPart(messageID, index, part)),
  }
}

// Build an assistant message with a reasoning/thinking part + text part
export function buildAssistantWithThinkingMessage(thinking: string, text: string): MessageWithParts {
  const messageID = "assistant_thinking_message"

  return {
    info: buildAssistantInfo(messageID),
    parts: [buildReasoningPart(messageID, thinking), buildTextPart(messageID, 1, text)],
  }
}

// Build a tool_use message + matching tool_result message pair (IDs must match)
export function buildToolUsePair(
  toolName: string,
  toolId: string,
): { toolUse: MessageWithParts; toolResult: MessageWithParts } {
  const toolUseMessageID = "assistant_tool_use_message"
  const toolResultMessageID = "user_tool_result_message"

  return {
    toolUse: {
      info: buildAssistantInfo(toolUseMessageID),
      parts: [buildToolUsePart(toolUseMessageID, toolName, toolId)],
    },
    toolResult: {
      info: buildUserInfo(toolResultMessageID),
      parts: [buildToolResultPart(toolResultMessageID, toolId)],
    },
  }
}

// Build a /btw user message (with an injected non-forgeable marker) + its assistant answer
// marker: a structural string that makes the user message "btw-marked" for testing
// secret: a recognizable string in the answer (e.g. "PURPLE-PANDA-47")
export function buildBtwPair(
  marker: string,
  secret: string,
): { btwUser: MessageWithParts; btwAnswer: MessageWithParts } {
  return {
    btwUser: buildUserMessage(`${marker}\n/btw remember this fixture request`),
    btwAnswer: buildAssistantMessage(`Fixture BTW answer contains ${secret}`),
  }
}

// Helper to run a strip hook function over a messages array and return the result
// The strip hook is passed in (not imported) so this stays decoupled before Task 6 exists
export function runStripTransform(
  messages: MessageWithParts[],
  stripHook: (ctx: { output: { messages: MessageWithParts[] } }) => void | Promise<void>,
): MessageWithParts[] {
  const ctx = { output: { messages: [...messages] } }
  void stripHook(ctx)

  return ctx.output.messages
}
