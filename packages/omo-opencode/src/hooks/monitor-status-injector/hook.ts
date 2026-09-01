import type { MonitorManager, MonitorRecord } from "../../features/monitor/types"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
  [key: string]: unknown
}

type TransformMessageInfo = {
  role: string
  sessionID?: string
  [key: string]: unknown
}

type MessageWithParts = {
  info: TransformMessageInfo
  parts: TransformPart[]
}

type MonitorStatusInjectorInput = {
  sessionID?: string
  [key: string]: unknown
}

type MonitorStatusInjectorOutput = {
  messages: MessageWithParts[]
}

export type MonitorStatusInjectorHook = {
  "experimental.chat.messages.transform"?: (
    input: MonitorStatusInjectorInput,
    output: MonitorStatusInjectorOutput,
  ) => Promise<void>
}

const MONITOR_STATUS_PREFIX = "Active monitors:"

function resolveSessionID(
  input: MonitorStatusInjectorInput,
  messages: MessageWithParts[],
): string | undefined {
  if (typeof input.sessionID === "string" && input.sessionID.length > 0) {
    return input.sessionID
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sessionID = messages[index]?.info.sessionID
    if (typeof sessionID === "string" && sessionID.length > 0) {
      return sessionID
    }
  }

  return undefined
}

function findLastUserMessageIndex(messages: MessageWithParts[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") {
      return index
    }
  }

  return -1
}

function findInjectedStatusPart(messages: MessageWithParts[]): TransformPart | undefined {
  for (const message of messages) {
    const part = message.parts.find(
      (candidate) =>
        candidate.synthetic === true &&
        candidate.type === "text" &&
        candidate.text?.startsWith(MONITOR_STATUS_PREFIX) === true,
    )
    if (part !== undefined) {
      return part
    }
  }

  return undefined
}

function isActiveMonitor(record: MonitorRecord): boolean {
  return record.status === "running" || record.status === "starting"
}

function formatMonitorRecord(record: MonitorRecord): string {
  return `${record.id} (${record.label}, ${record.status}, ${record.counters.matchedLines} matched)`
}

function buildStatusLine(records: MonitorRecord[]): string {
  return `${MONITOR_STATUS_PREFIX} ${records.map(formatMonitorRecord).join(", ")} - call monitor_stop to stop`
}

function createInjectedMessage(sessionID: string, statusLine: string): MessageWithParts {
  return {
    info: {
      role: "user",
      sessionID,
    },
    parts: [{ type: "text", text: statusLine, synthetic: true }],
  }
}

export function createMonitorStatusInjectorHook(
  monitorManager: MonitorManager,
  config: { enabled: boolean },
): MonitorStatusInjectorHook {
  return {
    "experimental.chat.messages.transform": async (input, output): Promise<void> => {
      if (!config.enabled || output.messages.length === 0) {
        return
      }

      const sessionID = resolveSessionID(input, output.messages)
      if (sessionID === undefined) {
        return
      }

      const activeMonitors = monitorManager.list(sessionID).filter(isActiveMonitor)
      if (activeMonitors.length === 0) {
        return
      }

      const statusLine = buildStatusLine(activeMonitors)
      const existingStatusPart = findInjectedStatusPart(output.messages)
      if (existingStatusPart !== undefined) {
        existingStatusPart.text = statusLine
        return
      }

      const lastUserMessageIndex = findLastUserMessageIndex(output.messages)
      if (lastUserMessageIndex === -1) {
        return
      }

      output.messages.splice(lastUserMessageIndex, 0, createInjectedMessage(sessionID, statusLine))
    },
  }
}
