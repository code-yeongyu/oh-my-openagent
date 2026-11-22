import {
  buildDynamicSystemPrompt,
  resolvePreset,
  type BuildDynamicSystemPromptOptions,
} from "@code-yeongyu/senpi/prompt-presets"
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all"
import {
  frameNativePrompt,
  replaceNativePromptFrames,
  type NativePromptContext,
  type NativePromptParts,
} from "./native-prompt-frame"
import { REFUSAL_IS_FINAL_RULE, withoutRefusalRule } from "./refusal-rule"
import {
  assertHephaestusSupportedModel,
  isHephaestusSupportedModel,
  isStandaloneHephaestusPreset,
} from "./hephaestus/model-support"

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
    toolSnippets: Object.fromEntries(
      selectedTools
        .filter((name) => toolSnippets[name] !== undefined)
        .map((name) => [nativeName(name), toolSnippets[name]]),
    ),
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

type NativeAgentPromptInput = {
  model: string | undefined
  /** The role without the refusal rule. */
  role: string
  /** The agent carries the refusal rule: the frame states it once, whichever model serves. */
  refusalRule: boolean
  tools: readonly string[]
  restriction?: "hephaestus"
  useTaskSystem: boolean
  toolSnippets?: Record<string, string>
  toolPermissions?: NativePromptContext["toolPermissions"]
}

/** The framed model core and the role that follows it for this model ("" on a preset that stands alone). */
function composeNativeAgentPrompt(input: NativeAgentPromptInput): NativePromptParts {
  const { model, role, restriction } = input
  if (restriction === "hephaestus") assertHephaestusSupportedModel(model)
  const identity = resolveNativePromptModel(model)
  const options = nativePromptOptions(input.tools, input.toolSnippets)
  const preset = resolvePreset(identity, { promptPreset: "auto" }, options)
  const core = preset?.prompt ?? buildDynamicSystemPrompt(options)
  const modelIdentity = model
    ? `Model: ${JSON.stringify({ provider: identity.provider, id: identity.id, preset: preset?.name ?? null })}`
    : ""
  // The rule sits in the frame, the one part a model switch rebuilds: a core that states it needs no second copy.
  const refusalRule = input.refusalRule && !core.includes(REFUSAL_IS_FINAL_RULE) ? REFUSAL_IS_FINAL_RULE : ""
  const body = [adaptNativePrompt(core, input.useTaskSystem), refusalRule, modelIdentity].filter(Boolean).join("\n\n")
  // The Hephaestus role rides in the frame context, so a model switch can drop it for a standalone preset and restore it.
  const hephaestusRole = restriction === "hephaestus" && role.length > 0
  const standalone = hephaestusRole && isStandaloneHephaestusPreset(preset?.name)
  const frame = frameNativePrompt(body, {
    model: model ?? "",
    tools: [...input.tools],
    ...(input.toolSnippets ? { toolSnippets: input.toolSnippets } : {}),
    ...(input.toolPermissions ? { toolPermissions: input.toolPermissions } : {}),
    ...(restriction ? { restriction } : {}),
    ...(input.useTaskSystem ? { useTaskSystem: true } : {}),
    ...(input.refusalRule ? { refusalRule: true } : {}),
    ...(hephaestusRole ? { role } : {}),
    ...(standalone ? { standalone: true } : {}),
  })
  return { frame, role: standalone ? "" : role }
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
  // A role that ends with the refusal rule hands the rule to the frame and follows it without the copy.
  const bareRole = withoutRefusalRule(role)
  const parts = composeNativeAgentPrompt({
    model,
    role: bareRole,
    refusalRule: bareRole !== role,
    tools: selectedTools,
    restriction,
    useTaskSystem,
    toolSnippets,
    toolPermissions,
  })
  return parts.role ? `${parts.frame}\n\n${parts.role}` : parts.frame
}

export function reconcileNativeModelPrompts(
  system: string[],
  model: string | undefined,
  toolSnippets?: Record<string, string>,
  toolPermissions?: NativePromptContext["toolPermissions"],
  runtimePermissions?: NativePromptContext["toolPermissions"],
): void {
  if (!model && !toolSnippets) return
  replaceNativePromptFrames(
    system,
    model,
    (context) => {
      if (context.restriction === "hephaestus" && !isHephaestusSupportedModel(context.model)) return undefined
      const rules = toolPermissions ?? context.toolPermissions
      const snippets = toolSnippets ?? context.toolSnippets
      const selected = toolSnippets
        ? Object.keys(toolSnippets).filter((name) => {
            let allowed = true
            const permissionName = ["edit", "write", "apply_patch"].includes(name)
              ? "edit"
              : ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(name)
                ? "read"
                : name
            for (const rule of [...(rules ?? []), ...(runtimePermissions ?? [])]) {
              const pattern = rule.pattern
                .split("*")
                .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join(".*")
              if (new RegExp(`^${pattern}$`).test(permissionName)) {
                allowed = rule.permission !== "deny" || (rule.scope !== undefined && rule.scope !== "*")
              }
            }
            return allowed
          })
        : context.tools
      const selectedSnippets = snippets
        ? Object.fromEntries(
            selected
              .map((name) => [name, snippets[name]])
              .filter((entry): entry is [string, string] => entry[1] !== undefined),
          )
        : undefined
      return composeNativeAgentPrompt({
        model: context.model,
        role: context.role ?? "",
        refusalRule: context.refusalRule === true,
        tools: selected,
        restriction: context.restriction,
        useTaskSystem: context.useTaskSystem === true,
        toolSnippets: selectedSnippets,
        toolPermissions: rules,
      })
    },
    toolSnippets !== undefined,
  )
}
