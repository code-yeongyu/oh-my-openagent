/**
 * The child's host-tool registry. Grant-side nested-host-scope and `buildChildSessionOptions`
 * both consume this table: `sessionBuiltin` names are the senpi session defaults
 * (`createAgentSession` `defaultActiveToolNames`) unioned into the child's structural set, and
 * `writeCapable` is the write classification for those same names. Unknown names fail closed
 * (write-capable). Never keep a second copy of either list.
 */
export type ChildHostTool = {
  readonly name: string
  readonly writeCapable: boolean
  readonly sessionBuiltin?: true
}

export const CHILD_HOST_TOOLS: readonly ChildHostTool[] = [
  { name: "read", writeCapable: false, sessionBuiltin: true },
  { name: "bash", writeCapable: true, sessionBuiltin: true },
  { name: "edit", writeCapable: true, sessionBuiltin: true },
  { name: "write", writeCapable: true, sessionBuiltin: true },
  { name: "grep", writeCapable: false, sessionBuiltin: true },
  { name: "powershell", writeCapable: true },
  { name: "find", writeCapable: false },
  { name: "glob", writeCapable: false },
  { name: "ls", writeCapable: false },
  { name: "list", writeCapable: false },
  { name: "lsp_diagnostics", writeCapable: false },
  { name: "lsp_goto_definition", writeCapable: false },
  { name: "lsp_find_references", writeCapable: false },
  { name: "lsp_symbols", writeCapable: false },
  { name: "web_search", writeCapable: false },
  { name: "web_fetch", writeCapable: false },
  { name: "webfetch", writeCapable: false },
  { name: "x_search", writeCapable: false },
  { name: "tool_search", writeCapable: false },
  { name: "ask_user_question", writeCapable: false },
  { name: "request_user_input", writeCapable: false },
]

const WRITE_CAPABLE = new Map(CHILD_HOST_TOOLS.map((tool) => [tool.name, tool.writeCapable]))

export const SENPI_SESSION_BUILTIN_NAMES: readonly string[] = CHILD_HOST_TOOLS.filter((tool) => tool.sessionBuiltin).map(
  (tool) => tool.name,
)

export function isWriteCapableHostTool(name: string): boolean {
  return WRITE_CAPABLE.get(name) !== false
}

/**
 * The names the in-process runner actually installs before allow/deny: senpi session builtins plus
 * merged custom tools (shared parent tools minus UI-only/task-team, plus member-scoped).
 */
export function childStructuralToolNames(customNames: readonly string[] = []): readonly string[] {
  return [...new Set([...SENPI_SESSION_BUILTIN_NAMES, ...customNames])]
}
