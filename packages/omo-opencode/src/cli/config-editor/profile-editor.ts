import * as p from "@clack/prompts"
import { copyEditorProfile, createEditorProfile, deleteEditorProfile, listEditorProfiles, type EditorSession } from "./backend"
import { choose, displayText, input, safeName } from "./prompt"

export async function editProfiles(session: EditorSession, view: string[]): Promise<string[]> {
  p.log.info("Profiles declared in the selected file only. Other layers may add or override profiles; this list does not show the effective configuration.")
  while (true) {
    const names = listEditorProfiles(session)
    const action = await choose(`Profiles in this file (${names.length})`, [
      { value: "create", label: "Create empty profile", hint: "Inherit shared and harness settings" },
      ...(names.length > 0 ? [
        { value: "edit", label: "List / edit profile declarations" },
        { value: "copy", label: "Copy profile declaration" },
        { value: "delete", label: "Delete profile declaration" },
      ] : []),
      { value: "back", label: "Back" },
    ])
    if (action === "back") return view
    if (action === "create" || action === "copy") {
      const source = action === "copy" ? await selectProfile(session, "Copy which profile declaration?") : undefined
      if (action === "copy" && source === undefined) continue
      const name = await input("New profile name", undefined, (value) => safeName(value) ?? (names.includes(value.trim()) ? "This profile already exists in the selected file." : undefined))
      if (source === undefined) createEditorProfile(session, name)
      else copyEditorProfile(session, source, name)
      p.log.success(`Staged profile ${displayText(name)}. Changes are written only when you save.`)
      return ["profiles", name]
    }
    const name = await selectProfile(session, action === "edit" ? "Edit which profile declaration?" : "Delete which profile declaration?")
    if (name === undefined) continue
    if (action === "edit") return ["profiles", name]
    p.log.warn(`Remove only profiles.${displayText(name)} from ${displayText(session.path)}. Other layers and running sessions are unaffected; another layer may still declare this name.`)
    const confirmation = await choose(`Stage deletion of profile ${name}?`, [
      { value: "keep", label: "Keep profile" },
      { value: "delete", label: "Stage deletion", hint: "Written only when you save; save creates a backup" },
    ])
    if (confirmation === "delete") {
      deleteEditorProfile(session, name)
      if (view[0] === "profiles" && view[1] === name) view = []
      p.log.success(`Staged deletion of ${displayText(name)}. Save to apply, or exit without saving to discard.`)
      return view
    }
  }
}

async function selectProfile(session: EditorSession, message: string): Promise<string | undefined> {
  const names = listEditorProfiles(session)
  const index = await choose<number>(message, [
    ...names.map((name, value) => ({ value, label: name })),
    { value: -1, label: "Back" },
  ])
  return names[index]
}
