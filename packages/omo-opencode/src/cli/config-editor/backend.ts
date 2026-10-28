import { setEditorValue, type EditorSession } from "./session"

export {
  discoverEditorTargets,
  isEditorModified,
  openEditorSession,
  readEditorValue,
  saveEditorSession,
  setEditorValue,
  withEditorTransaction,
  type EditorSession,
  type EditorTarget,
} from "./session"

export type EditorValidationIssue = {
  readonly code: "invalid-value"
  readonly path: readonly string[]
  readonly message: string
}

export type EditorValidationResult = {
  readonly valid: boolean
  readonly issues: readonly EditorValidationIssue[]
}

/** Validate a proposed edit without changing staged values, dirty state, or files. */
export function validateEditorValue(session: EditorSession, path: readonly string[], value: unknown): EditorValidationResult {
  const staged: EditorSession = { ...session, config: structuredClone(session.config), edits: structuredClone(session.edits) }
  try {
    setEditorValue(staged, path, value)
    return { valid: true, issues: [] }
  } catch (error) {
    return {
      valid: false,
      issues: [{ code: "invalid-value", path: [...path], message: error instanceof Error ? error.message : String(error) }],
    }
  }
}
