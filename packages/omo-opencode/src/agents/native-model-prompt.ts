import {
  buildDynamicSystemPrompt,
  resolvePreset,
  type BuildDynamicSystemPromptOptions,
} from "@code-yeongyu/senpi/prompt-presets"
import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all"
import { frameNativePrompt, replaceNativePromptFrames, type NativePromptContext } from "./native-prompt-frame"
import { assertHephaestusSupportedModel, isHephaestusSupportedModel } from "./hephaestus/model-support"

const catalog = new Map<string, ReturnType<typeof getBuiltinModels>[number]>(
  getBuiltinProviders().flatMap((provider) =>
    getBuiltinModels(provider).map((model) => [`${provider}/${model.id}`, model] as const),
  ),
)

export function resolveNativePromptModel(model = "") {
  const known = catalog.get(model)
  if (known) return known
  const slash = model.indexOf("/")
  return {
    provider: slash === -1 ? "" : model.slice(0, slash),
    id: slash === -1 ? model : model.slice(slash + 1),
  }
}

export function getNativePromptSource(model?: string): string {
  const identity = resolveNativePromptModel(model)
  return resolvePreset(identity, { promptPreset: "auto" })?.name ?? "default"
}

export function nativePromptOptions(
  selectedTools: readonly string[] = [],
  toolSnippets: Readonly<Record<string, string>> = {},
): BuildDynamicSystemPromptOptions {
  const nativeName = (name: string) =>
    name === "question" ? "ask_user_question" : name === "todowrite" ? "todo" : name
  return {
    cwd: "",
    selectedTools: selectedTools.map(nativeName),
    toolSnippets: Object.fromEntries(selectedTools
      .filter((name) => toolSnippets[name] !== undefined)
      .map((name) => [nativeName(name), toolSnippets[name]])),
    promptGuidelines: [],
    contextFiles: [],
    skills: [],
    surface: "terminal",
    appName: "OmO",
  }
}

/** The sole host transform; model-core prose is otherwise preserved byte for byte. */
export function adaptNativePrompt(prompt: string, useTaskSystem = false): string {
  return prompt
    .replaceAll(/\bask_user_question\b/g, "question")
    .replaceAll(" (waitForAnswer true when the next step depends on the answer)", "")
    .replaceAll("`todo`", useTaskSystem ? "`task_create` / `task_update` / `task_list` / `task_get`" : "`todowrite`")
}

export function buildNativeAgentPrompt(
  model: string | undefined,
  role: string,
  selectedTools: readonly string[] = [],
  restriction?: "hephaestus",
  useTaskSystem = false,
  toolSnippets?: Record<string, string>,
  toolPermissions?: NativePromptContext["toolPermissions"],
): string {
  if (restriction === "hephaestus") assertHephaestusSupportedModel(model)
  const identity = resolveNativePromptModel(model)
  const options = nativePromptOptions(selectedTools, toolSnippets)
  const preset = resolvePreset(identity, { promptPreset: "auto" }, options)
  const core = preset?.prompt ?? buildDynamicSystemPrompt(options)
  const modelIdentity = model
    ? `Model: ${JSON.stringify({ provider: identity.provider, id: identity.id, preset: preset?.name ?? null })}`
    : ""
  const body = [adaptNativePrompt(core, useTaskSystem), modelIdentity].filter(Boolean).join("\n\n")
  const framed = frameNativePrompt(body, {
    model: model ?? "",
    tools: [...selectedTools],
    ...(toolSnippets ? { toolSnippets } : {}),
    ...(toolPermissions ? { toolPermissions } : {}),
    ...(restriction ? { restriction } : {}),
    ...(useTaskSystem ? { useTaskSystem } : {}),
  })
  return role ? `${framed}\n\n${role}` : framed
}

export function reconcileNativeModelPrompts(
  system: string[],
  model: string | undefined,
  toolSnippets?: Record<string, string>,
  toolPermissions?: NativePromptContext["toolPermissions"],
  runtimePermissions?: NativePromptContext["toolPermissions"],
): void {
  if (!model && !toolSnippets) return
  replaceNativePromptFrames(system, model, (context) => {
    if (context.restriction === "hephaestus" && !isHephaestusSupportedModel(context.model)) return undefined
    const rules = toolPermissions ?? context.toolPermissions
    const snippets = toolSnippets ?? context.toolSnippets
    const selected = toolSnippets ? Object.keys(toolSnippets).filter((name) => {
      let allowed = true
      const permissionName = ["edit", "write", "apply_patch"].includes(name) ? "edit"
        : ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(name) ? "read" : name
      for (const rule of [...rules ?? [], ...runtimePermissions ?? []]) {
        const pattern = rule.pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
        if (new RegExp(`^${pattern}$`).test(permissionName)) {
          allowed = rule.permission !== "deny" || (rule.scope !== undefined && rule.scope !== "*")
        }
      }
      return allowed
    }) : context.tools
    const selectedSnippets = snippets
      ? Object.fromEntries(selected.map((name) => [name, snippets[name]]).filter((entry): entry is [string, string] => entry[1] !== undefined))
      : undefined
    return buildNativeAgentPrompt(context.model, "", selected, context.restriction,
      context.useTaskSystem, selectedSnippets, rules)
  }, toolSnippets !== undefined)
}
