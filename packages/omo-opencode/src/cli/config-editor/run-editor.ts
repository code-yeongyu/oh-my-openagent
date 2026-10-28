import * as p from "@clack/prompts"
import { resolve } from "node:path"
import { choose, record, EditorCancelled, displayText } from "./prompt"
import { bulkSetModels, editEntries, editJsonField, editRootDefault, isOpenCodeView } from "./entry-editor"
import { discoverEditorTargets, openEditorSession, isEditorModified, saveEditorSession, type EditorSession } from "./backend"

export type ConfigEditorOptions = {
  readonly directory?: string
  readonly file?: string
}

async function chooseView(session: EditorSession): Promise<string[]> {
  const roots: { label: string; path: string[] }[] = [
    { label: "Shared across harnesses", path: [] },
    { label: "OpenCode [opencode]", path: ["[opencode]"] },
    { label: "OmO Native [native]", path: ["[native]"] },
    { label: "Codex [codex]", path: ["[codex]"] },
  ]
  for (const name of Object.keys(record(session.config["profiles"]))) {
    for (const base of roots.slice(0, 4)) roots.push({ label: `Profile ${name} / ${base.label}`, path: ["profiles", name, ...base.path] })
  }
  const index = await choose<number>("Which configuration view?", roots.map((root, value) => ({ value, label: root.label })), 1)
  return roots[index]?.path ?? []
}

async function discard(session: EditorSession): Promise<boolean> {
  if (!isEditorModified(session)) return true
  try {
    const answer = await choose("Discard unsaved changes?", [{ value: "keep", label: "Keep editing" }, { value: "discard", label: "Discard changes and exit" }])
    return answer === "discard"
  } catch (error) {
    if (error instanceof EditorCancelled) return false
    throw error
  }
}

async function menuLoop(session: EditorSession, initialView: string[]): Promise<number> {
  let view = initialView
  while (true) {
    try {
      const label = view.length === 0 ? "Shared" : view.join(" / ")
      const action = await choose(`Configure ${label}${isEditorModified(session) ? " (unsaved changes)" : ""}`, [
        { value: "agents", label: "Agents", hint: "Models, fallbacks, permissions and settings" },
        { value: "categories", label: "Categories", hint: "Models, descriptions and settings" },
        ...(isOpenCodeView(view) ? [{ value: "default", label: "Default run agent" }] : []),
        { value: "bulk", label: "Bulk primary model assignment" },
        { value: "field", label: "Other configuration fields", hint: "Schema-validated JSON values" },
        { value: "view", label: "Change configuration view" },
        { value: "save", label: "Save changes and exit" },
        { value: "discard", label: "Exit without saving" },
      ])
      if (action === "agents" || action === "categories") await editEntries(session, view, action)
      else if (action === "default") await editRootDefault(session, view)
      else if (action === "bulk") await bulkSetModels(session, view)
      else if (action === "field") await editJsonField(session, view)
      else if (action === "view") view = await chooseView(session)
      else if (action === "discard") {
        if (await discard(session)) { p.outro("Exited without saving."); return 0 }
      } else {
        if (!isEditorModified(session)) { p.outro("No changes to save."); return 0 }
        const result = saveEditorSession(session)
        if (result.backupPath !== undefined) p.log.info(`Backup: ${displayText(result.backupPath)}`)
        p.outro(`Saved ${displayText(result.path)}`)
        return 0
      }
    } catch (error) {
      if (error instanceof EditorCancelled) {
        if (await discard(session)) { p.cancel("Configuration editor cancelled. No changes saved."); return 0 }
      } else {
        p.log.error(displayText(error instanceof Error ? error.message : String(error)))
        p.log.info("Your edits remain in memory. Fix the value, retry saving, or exit without saving.")
      }
    }
  }
}

export async function runConfigEditor(options: ConfigEditorOptions = {}): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("The configuration editor needs an interactive terminal. Run `omo-agent-toolkit config edit` in a terminal.")
    return 1
  }
  p.intro("OMO configuration editor")
  try {
    const directory = resolve(options.directory ?? process.cwd())
    const targets = discoverEditorTargets(directory)
    const target = options.file === undefined
      ? targets[await choose<number>("Choose the file to edit", targets.map((entry, value) => ({ value, label: entry.path, hint: `${entry.scope}${entry.exists ? "" : " / create on save"}` })))]
      : { path: resolve(directory, options.file), scope: "project" as const }
    if (target === undefined) return 1
    const session = openEditorSession(target.path, target.scope)
    p.log.info(`File: ${displayText(session.path)}`)
    p.log.info("Edits affect only the selected file and view. Other layers and active profiles may override these values.")
    const view = await chooseView(session)
    return await menuLoop(session, view)
  } catch (error) {
    if (error instanceof EditorCancelled) { p.cancel("Configuration editor cancelled. No changes saved."); return 0 }
    p.log.error(displayText(error instanceof Error ? error.message : String(error)))
    return 1
  }
}
