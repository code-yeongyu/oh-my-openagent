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

export interface TextDocumentIdentifier {
  uri: string
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number | null
}

export interface TextEdit {
  range: Range
  newText: string
}

export interface TextDocumentEdit {
  textDocument: VersionedTextDocumentIdentifier
  edits: TextEdit[]
}

export interface CreateFile {
  kind: "create"
  uri: string
  options?: { overwrite?: boolean; ignoreIfExists?: boolean }
}

export interface RenameFile {
  kind: "rename"
  oldUri: string
  newUri: string
  options?: { overwrite?: boolean; ignoreIfExists?: boolean }
}

export interface DeleteFile {
  kind: "delete"
  uri: string
  options?: { recursive?: boolean; ignoreIfNotExists?: boolean }
}

export interface WorkspaceEdit {
  changes?: { [uri: string]: TextEdit[] }
  documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[]
}

export interface PrepareRenameResult {
  range: Range
  placeholder?: string
}

export interface PrepareRenameDefaultBehavior {
  defaultBehavior: boolean
}

export interface Command {
  title: string
  command: string
  arguments?: unknown[]
}

export interface CodeActionContext {
  diagnostics: Diagnostic[]
  only?: string[]
  triggerKind?: CodeActionTriggerKind
}

export type CodeActionTriggerKind = 1 | 2

export interface CodeAction {
  title: string
  kind?: string
  diagnostics?: Diagnostic[]
  isPreferred?: boolean
  disabled?: { reason: string }
  edit?: WorkspaceEdit
  command?: Command
  data?: unknown
}
