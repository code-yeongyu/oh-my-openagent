export interface LSPServerConfig {
  id: string
  command: string[]
  extensions: string[]
  disabled?: boolean
  env?: Record<string, string>
  initialization?: Record<string, unknown>
}

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface LocationLink {
  targetUri: string
  targetRange: Range
  targetSelectionRange: Range
  originSelectionRange?: Range
}

export interface SymbolInfo {
  name: string
  kind: number
  location: Location
  containerName?: string
}

export interface DocumentSymbol {
  name: string
  kind: number
  range: Range
  selectionRange: Range
  children?: DocumentSymbol[]
}

export interface Diagnostic {
  range: Range
  severity?: number
  code?: string | number
  source?: string
  message: string
}

export interface HoverResult {
  contents:
    | { kind?: string; value: string }
    | string
    | Array<{ kind?: string; value: string } | string>
  range?: Range
}
