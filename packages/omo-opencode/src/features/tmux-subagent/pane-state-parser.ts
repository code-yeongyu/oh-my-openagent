import type { TmuxPaneInfo } from "./types"

const MANDATORY_PANE_FIELD_COUNT = 10

type ParsedPaneState = {
  windowWidth: number
  windowHeight: number
  windowActive: boolean
  sessionAttached: boolean
  panes: TmuxPaneInfo[]
}

type ParsedPaneLine = {
  pane: TmuxPaneInfo
  windowWidth: number
  windowHeight: number
  windowActive: boolean
  sessionAttached: boolean
}

type MandatoryPaneFields = [
  paneId: string,
  widthString: string,
  heightString: string,
  leftString: string,
  topString: string,
  activeString: string,
  windowWidthString: string,
  windowHeightString: string,
  windowActiveString: string,
  sessionAttachedString: string,
]

export function parsePaneStateOutput(stdout: string): ParsedPaneState | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)

  if (lines.length === 0) return null

  const parsedPaneLines = lines
    .map(parsePaneLine)
    .filter((parsedPaneLine): parsedPaneLine is ParsedPaneLine => parsedPaneLine !== null)

  if (parsedPaneLines.length === 0) return null

  const latestPaneLine = parsedPaneLines[parsedPaneLines.length - 1]
  if (!latestPaneLine) return null

  return {
    windowWidth: latestPaneLine.windowWidth,
    windowHeight: latestPaneLine.windowHeight,
    windowActive: latestPaneLine.windowActive,
    sessionAttached: latestPaneLine.sessionAttached,
    panes: parsedPaneLines.map(({ pane }) => pane),
  }
}

function parsePaneLine(line: string): ParsedPaneLine | null {
  const fields = line.split("\t")
  const mandatoryFields = getMandatoryPaneFields(fields)
  if (!mandatoryFields) return null

  const [paneId, widthString, heightString, leftString, topString, activeString, windowWidthString, windowHeightString, windowActiveString, sessionAttachedString] = mandatoryFields

  const width = parseInteger(widthString)
  const height = parseInteger(heightString)
  const left = parseInteger(leftString)
  const top = parseInteger(topString)
  const isActive = parseActiveValue(activeString)
  const windowWidth = parseInteger(windowWidthString)
  const windowHeight = parseInteger(windowHeightString)
  const windowActive = parseActiveValue(windowActiveString)
  const sessionAttached = parseAttachedValue(sessionAttachedString)

  if (
    width === null ||
    height === null ||
    left === null ||
    top === null ||
    isActive === null ||
    windowWidth === null ||
    windowHeight === null ||
    windowActive === null ||
    sessionAttached === null
  ) {
    return null
  }

  return {
    pane: {
      paneId,
      width,
      height,
      left,
      top,
      title: fields.slice(MANDATORY_PANE_FIELD_COUNT).join("\t"),
      isActive,
    },
    windowWidth,
    windowHeight,
    windowActive,
    sessionAttached,
  }
}

function getMandatoryPaneFields(fields: string[]): MandatoryPaneFields | null {
  if (fields.length < MANDATORY_PANE_FIELD_COUNT) return null

  const [paneId, widthString, heightString, leftString, topString, activeString, windowWidthString, windowHeightString, windowActiveString, sessionAttachedString] = fields

  if (
    paneId === undefined ||
    widthString === undefined ||
    heightString === undefined ||
    leftString === undefined ||
    topString === undefined ||
    activeString === undefined ||
    windowWidthString === undefined ||
    windowHeightString === undefined ||
    windowActiveString === undefined ||
    sessionAttachedString === undefined
  ) {
    return null
  }

  return [
    paneId,
    widthString,
    heightString,
    leftString,
    topString,
    activeString,
    windowWidthString,
    windowHeightString,
    windowActiveString,
    sessionAttachedString,
  ]
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null

  const parsedValue = Number.parseInt(value, 10)
  return Number.isNaN(parsedValue) ? null : parsedValue
}

function parseActiveValue(value: string): boolean | null {
  if (value === "1") return true
  if (value === "0") return false
  return null
}

function parseAttachedValue(value: string): boolean | null {
  if (!/^\d+$/.test(value)) return null
  return Number.parseInt(value, 10) > 0
}
