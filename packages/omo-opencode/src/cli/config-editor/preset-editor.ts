import * as p from "@clack/prompts"
import { EDITOR_PRESET_IDS, listEditorProfiles, previewEditorPreset, readEditorPresetCache, stageEditorPreset, type EditorSession, type EditorPresetPreview, type EditorPresetRole } from "./backend"
import { choose, displayText, input, safeName } from "./prompt"

const descriptions = {
  performance: "Current role requirement chains; premium models may lead",
  balanced: "Kimi / GLM / Sonnet; GPT-5.6 Sol for GPT lanes",
  budget: "Kimi / GLM for reasoning; smaller models for simple work",
} as const

export async function importBuiltinPreset(session: EditorSession): Promise<string[] | undefined> {
  const id = await choose("Import built-in preset", [
    ...EDITOR_PRESET_IDS.map((value) => ({ value, label: value, hint: descriptions[value] })),
    { value: "back", label: "Back" },
  ], "back")
  if (id === "back") return undefined
  const cache = readEditorPresetCache()
  const preview = previewEditorPreset(id, cache)
  p.note([
    `Preset: ${id}`,
    `Provider-models cache updated: ${preview.cacheUpdatedAt ?? "unknown / invalid"}`,
    "Cache-only listing check. No live availability or authentication check.",
    "Cached listings can be stale. No price or savings guarantee; this is not a spend cap.",
    "Models are copied without variant tuning. Other layers can retain reasoning / variants, override chains, and runtime fallback policies may route outside these candidates.",
    "Imports become ordinary editable declarations and do not receive future built-in updates. Save writes them; importing does not activate a profile or change running sessions.",
    ...preview.cacheIssues,
  ].map(displayText).join("\n"), "Built-in preset preview")
  p.note(preview.roles.map((role) =>
    `${role.section}.${role.name}: ${role.chain[0] ?? "UNMATCHED"} (${Math.max(0, role.chain.length - 1)} fallbacks; ${role.skipped.length} skipped)`
  ).map(displayText).join("\n"), "All roles: primary models and coverage")
  if (!preview.complete) {
    p.log.warn(`Import unavailable. Missing roles: ${displayText(preview.missingRoles.join(", "))}. Refresh your local provider-models cache through OpenCode, then preview again.`)
  }
  while (true) {
    const action = await choose("Review preset / stage as a new profile", [
      { value: "back", label: "Back", hint: "Keep current declarations" },
      { value: "inspect", label: "Inspect full model chain", hint: "All retained and skipped candidates, by role" },
      ...(preview.complete ? [{ value: "stage", label: "Import as new profile", hint: "Editable; written only when you save" }] : []),
    ], "back")
    if (action === "back") return undefined
    if (action === "stage") break
    await inspectPreset(preview)
  }
  const names = listEditorProfiles(session)
  const name = await input("New profile name", undefined, (value) => safeName(value) ?? (names.includes(value.trim()) ? "This profile already exists in the selected file." : undefined))
  // Read afresh so a cache change cannot silently stage different chains from the preview.
  const current = readEditorPresetCache()
  const next = previewEditorPreset(id, current)
  if (JSON.stringify(next) !== JSON.stringify(preview)) throw new Error("The provider-models cache changed. Preview the preset again before importing.")
  stageEditorPreset(session, name, id, current)
  p.log.success(`Staged profile ${displayText(name)}. Edit its OpenCode settings, then save or discard through the normal editor. The profile is not activated.`)
  return ["profiles", name, "[opencode]"]
}

async function inspectPreset(preview: EditorPresetPreview): Promise<void> {
  while (true) {
    const index = await choose<number>("Inspect which role?", [
      { value: -1, label: "Back" },
      ...preview.roles.map((role, value) => ({ value, label: `${role.section}.${role.name}`, hint: `${role.chain.length} retained; ${role.skipped.length} skipped${role.chain.length === 0 ? "; UNMATCHED" : ""}` })),
    ], -1)
    const role = preview.roles[index]
    if (role === undefined) return
    await inspectRole(role)
  }
}

async function inspectRole(role: EditorPresetRole): Promise<void> {
  const rows = [
    ...role.chain.map((model, index) => `${index + 1}. RETAINED ${model}`),
    ...role.skipped.map(({ model, reason }) => `SKIPPED ${model}: ${reason}`),
  ]
  const pageSize = 8
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  let page = 0
  while (true) {
    p.note((rows.slice(page * pageSize, (page + 1) * pageSize).join("\n") || "UNMATCHED: no curated candidates").split("\n").map(displayText).join("\n"), `${role.section}.${role.name}: page ${page + 1}/${pages}`)
    const action = await choose("Full model chain", [
      { value: "back", label: "Back to roles" },
      ...(page > 0 ? [{ value: "previous", label: "Previous page" }] : []),
      ...(page + 1 < pages ? [{ value: "next", label: "Next page" }] : []),
    ], "back")
    if (action === "back") return
    page += action === "next" ? 1 : -1
  }
}
