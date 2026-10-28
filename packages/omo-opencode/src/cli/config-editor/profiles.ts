import { readEditorValue, setEditorValue, withEditorTransaction, type EditorSession } from "./session"

/** Names declared in this file, including staged edits; not the merged effective profiles. */
export function listEditorProfiles(session: EditorSession): readonly string[] {
  const profiles = readEditorValue(session, ["profiles"])
  if (profiles === undefined) return []
  if (typeof profiles !== "object" || profiles === null || Array.isArray(profiles)) {
    throw new Error("The selected file's profiles field must be an object. Repair it before managing profiles.")
  }
  return Object.keys(profiles)
}

function assertNewName(session: EditorSession, name: string): void {
  if (!name.trim() || name !== name.trim()) throw new Error("Enter a profile name without leading or trailing whitespace.")
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new Error("Profile names cannot contain terminal control characters.")
  if (["__proto__", "constructor", "prototype"].includes(name)) throw new Error("This profile name is reserved.")
  if (listEditorProfiles(session).includes(name)) throw new Error("This profile already exists in the selected file.")
}

function assertExisting(session: EditorSession, name: string): void {
  if (!listEditorProfiles(session).includes(name)) throw new Error("This profile is not declared in the selected file.")
}

/** Stage an empty declaration, inheriting the shared and harness layers when selected. */
export function createEditorProfile(session: EditorSession, name: string): void {
  assertNewName(session, name)
  withEditorTransaction(session, (staged) => setEditorValue(staged, ["profiles", name], {}))
}

/** Copy only the selected file's declaration, never materialized defaults or other files. */
export function copyEditorProfile(session: EditorSession, source: string, name: string): void {
  assertExisting(session, source)
  assertNewName(session, name)
  withEditorTransaction(session, (staged) => setEditorValue(staged, ["profiles", name], readEditorValue(staged, ["profiles", source])))
}

/** Stage removal from this file; another configuration layer may still declare this name. */
export function deleteEditorProfile(session: EditorSession, name: string): void {
  assertExisting(session, name)
  withEditorTransaction(session, (staged) => setEditorValue(staged, ["profiles", name], undefined))
}
