export type BackgroundOutputMessage = {
  info?: { role?: string; time?: string | { created?: number }; agent?: string }
  parts?: Array<{
    type?: string
    text?: string
    content?: string | Array<{ type: string; text?: string }>
    name?: string
  }>
}

export type BackgroundOutputMessagesResult =
  | { data?: BackgroundOutputMessage[]; error?: unknown }
  | BackgroundOutputMessage[]

export type FullSessionMessagePart = {
  type?: string
  text?: string
  thinking?: string
  content?: string | Array<{ type?: string; text?: string }>
  output?: string
}

export type FullSessionMessage = {
  id?: string
  info?: { role?: string; time?: string; agent?: string }
  parts?: FullSessionMessagePart[]
}

export function getErrorMessage(value: BackgroundOutputMessagesResult): string | null {
  if (Array.isArray(value)) return null
  if (value.error === undefined || value.error === null) return null
  if (typeof value.error === "string" && value.error.length > 0) return value.error
  return String(value.error)
}

export function isSessionMessage(value: unknown): value is {
  info?: { role?: string; time?: string }
  parts?: Array<{
    type?: string
    text?: string
    content?: string | Array<{ type: string; text?: string }>
    name?: string
  }>
} {
  return typeof value === "object" && value !== null
}

export function extractMessages(value: BackgroundOutputMessagesResult): BackgroundOutputMessage[] {
  if (Array.isArray(value)) {
    return value.filter(isSessionMessage)
  }
  if (Array.isArray(value.data)) {
    return value.data.filter(isSessionMessage)
  }
  return []
}

export function extractToolResultText(part: FullSessionMessagePart): string[] {
  if (typeof part.content === "string" && part.content.length > 0) {
    return [part.content]
  }

  if (Array.isArray(part.content)) {
    const blocks = part.content
      .filter((block) => (block.type === "text" || block.type === "reasoning") && block.text)
      .map((block) => block.text as string)
    if (blocks.length > 0) return blocks
  }

  if (part.output && part.output.length > 0) {
    return [part.output]
  }

  return []
}
