import type { TmuxPaneInfo } from "./types"

const MANDATORY_PANE_FIELD_COUNT = 8

type ParsedPaneState = {
  windowWidth: number
  windowHeight: number
  panes: TmuxPaneInfo[]
}

type ParsedPaneLine = {
  pane: TmuxPaneInfo
  windowWidth: number
  windowHeight: number
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
    panes: parsedPaneLines.map(({ pane }) => pane),
  }
}

function parsePaneLine(line: string): ParsedPaneLine | null {
  const fields = line.split("\t")
  const mandatoryFields = getMandatoryPaneFields(fields)
  if (!mandatoryFields) return null

  const [paneId, widthString, heightString, leftString, topString, activeString, windowWidthString, windowHeightString] = mandatoryFields

  const width = parseInteger(widthString)
  const height = parseInteger(heightString)
  const left = parseInteger(leftString)
  const top = parseInteger(topString)
  const windowWidth = parseInteger(windowWidthString)
  const windowHeight = parseInteger(windowHeightString)

  if (
    width === null ||
    height === null ||
    left === null ||
    top === null ||
    windowWidth === null ||
    windowHeight === null
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
      isActive: activeString === "1",
    },
    windowWidth,
    windowHeight,
  }
}

function getMandatoryPaneFields(fields: string[]): MandatoryPaneFields | null {
  if (fields.length < MANDATORY_PANE_FIELD_COUNT) return null

  const [paneId, widthString, heightString, leftString, topString, activeString, windowWidthString, windowHeightString] = fields

  if (
    paneId === undefined ||
    widthString === undefined ||
    heightString === undefined ||
    leftString === undefined ||
    topString === undefined ||
    activeString === undefined ||
    windowWidthString === undefined ||
    windowHeightString === undefined
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
  ]
}

function parseInteger(value: string): number | null {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isNaN(parsedValue) ? null : parsedValue
}
