export function getSessionId(props?: { sessionID?: string; sessionId?: string }): string | undefined {
  return props?.sessionID ?? props?.sessionId
}

export function getInfoSessionId(props?: {
  info?: { sessionID?: string; sessionId?: string }
}): string | undefined {
  return props?.info?.sessionID ?? props?.info?.sessionId
}

export function getPartSessionId(props?: {
  part?: { sessionID?: string; sessionId?: string }
}): string | undefined {
  return props?.part?.sessionID ?? props?.part?.sessionId
}

export function getPartMessageId(props?: {
  part?: { messageID?: string }
}): string | undefined {
  return props?.part?.messageID
}

export function getDeltaMessageId(props?: {
  messageID?: string
}): string | undefined {
  return props?.messageID
}
