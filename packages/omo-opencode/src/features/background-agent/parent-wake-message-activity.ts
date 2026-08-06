type ParentWakeMessageTime = {
  readonly created?: unknown
  readonly updated?: unknown
  readonly completed?: unknown
  readonly start?: unknown
  readonly end?: unknown
}

type ParentWakeMessageActivityPart = {
  readonly time?: ParentWakeMessageTime
  readonly state?: {
    readonly time?: ParentWakeMessageTime
  }
}

type ParentWakeMessageActivity = {
  readonly info?: {
    readonly time?: ParentWakeMessageTime
  }
  readonly time?: ParentWakeMessageTime
  readonly parts?: readonly ParentWakeMessageActivityPart[]
}

function timestampFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  return undefined
}

function latestTimestamp(...values: readonly unknown[]): number | undefined {
  let latest: number | undefined
  for (const value of values) {
    const timestamp = timestampFromUnknown(value)
    if (timestamp === undefined) {
      continue
    }
    if (latest === undefined || timestamp > latest) {
      latest = timestamp
    }
  }
  return latest
}

function latestTimeActivity(time: ParentWakeMessageTime | undefined): number | undefined {
  if (!time) {
    return undefined
  }
  return latestTimestamp(time.created, time.updated, time.completed, time.start, time.end)
}

export function getParentWakeMessageCreatedAt(message: ParentWakeMessageActivity): number | undefined {
  return timestampFromUnknown(message.info?.time?.created ?? message.time?.created)
}

export function getParentWakeMessageActivityAt(message: ParentWakeMessageActivity): number | undefined {
  let latest = latestTimestamp(
    latestTimeActivity(message.info?.time),
    latestTimeActivity(message.time),
  )
  for (const part of message.parts ?? []) {
    const partActivity = latestTimestamp(
      latestTimeActivity(part.time),
      latestTimeActivity(part.state?.time),
    )
    if (partActivity !== undefined && (latest === undefined || partActivity > latest)) {
      latest = partActivity
    }
  }
  return latest
}
