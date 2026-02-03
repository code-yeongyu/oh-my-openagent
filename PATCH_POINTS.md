# Patch Points - Agent Type Gating/Registration

This file lists all known locations in the TypeScript source where agent names are enumerated, gated, or registered. Each entry includes the file path, matching pattern, purpose, and a modification plan to support extensible/custom agents.

## Schema Validation / Type Gating

### BuiltinAgentNameSchema
- Path: `src/config/schema.ts`
- Pattern:
```ts
export const BuiltinAgentNameSchema = z.enum([
  "sisyphus",
  "hephaestus",
  "prometheus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "metis",
  "momus",
  "atlas",
])
```
- Purpose: Hard-coded list of builtin agent names for config validation and downstream type use.
- Modify: Replace with `z.string()` or `z.enum([...]).or(z.string())`, and track a separate list for builtins (used for defaults only).

### OverridableAgentNameSchema
- Path: `src/config/schema.ts`
- Pattern:
```ts
export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "sisyphus",
  "hephaestus",
  "sisyphus-junior",
  "OpenCode-Builder",
  "prometheus",
  "metis",
  "momus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "atlas",
])
```
- Purpose: Whitelist of names allowed in the `agents` override block.
- Modify: Move to `z.string()` with optional validation of known builtins, or allow `z.string().min(1)` while warning on unknown names.

### AgentOverridesSchema
- Path: `src/config/schema.ts`
- Pattern:
```ts
export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  sisyphus: AgentOverrideConfigSchema.optional(),
  hephaestus: AgentOverrideConfigSchema.optional(),
  "sisyphus-junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: AgentOverrideConfigSchema.optional(),
  metis: AgentOverrideConfigSchema.optional(),
  momus: AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  atlas: AgentOverrideConfigSchema.optional(),
})
```
- Purpose: Restricts override keys to a fixed set of agent names.
- Modify: Replace with `z.record(z.string(), AgentOverrideConfigSchema)` (plus optional reserved key validation).

### AgentNameSchema (alias to builtins)
- Path: `src/config/schema.ts`
- Pattern:
```ts
export const AgentNameSchema = BuiltinAgentNameSchema
```
- Purpose: Forces agent names to be builtin-only in any place that consumes `AgentNameSchema`.
- Modify: Extend to allow custom names (e.g., `z.union([BuiltinAgentNameSchema, z.string()])`).

### Builtin agent type unions
- Path: `src/agents/types.ts`
- Pattern:
```ts
export type BuiltinAgentName =
  | "sisyphus"
  | "hephaestus"
  | "oracle"
  | "librarian"
  | "explore"
  | "multimodal-looker"
  | "metis"
  | "momus"
  | "atlas"

export type OverridableAgentName =
  | "build"
  | BuiltinAgentName

export type AgentName = BuiltinAgentName
```
- Purpose: TS-level compile-time gate for builtins (and limited override keys).
- Modify: Introduce `type AgentName = BuiltinAgentName | string` (or branded string) and flow through configs/registries accordingly.

### disabled_agents validation
- Path: `src/config/schema.ts`
- Pattern:
```ts
disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
```
- Purpose: Prevents disabling custom agents because the schema only permits builtins.
- Modify: Allow string array with validation against known names; optionally warn on unknown.

## Registration / Metadata / Factory

### agentSources registry
- Path: `src/agents/utils.ts`
- Pattern:
```ts
const agentSources: Record<BuiltinAgentName, AgentSource> = {
  sisyphus: createSisyphusAgent,
  hephaestus: createHephaestusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  metis: createMetisAgent,
  momus: createMomusAgent,
  atlas: createAtlasAgent as unknown as AgentFactory,
}
```
- Purpose: Hard-coded factory registry for built-in agents only.
- Modify: Add dynamic registry (plugins/config) and merge into `agentSources` before `createBuiltinAgents` iterates.

### agentMetadata registry
- Path: `src/agents/utils.ts`
- Pattern:
```ts
const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  oracle: ORACLE_PROMPT_METADATA,
  librarian: LIBRARIAN_PROMPT_METADATA,
  explore: EXPLORE_PROMPT_METADATA,
  "multimodal-looker": MULTIMODAL_LOOKER_PROMPT_METADATA,
  metis: metisPromptMetadata,
  momus: momusPromptMetadata,
  atlas: atlasPromptMetadata,
}
```
- Purpose: Sisyphus prompt sections only include agents listed here.
- Modify: Extend registry to accept plugin-provided metadata; allow missing metadata with safe defaults.

### createBuiltinAgents special-case skip list
- Path: `src/agents/utils.ts`
- Pattern:
```ts
for (const [name, source] of Object.entries(agentSources)) {
  const agentName = name as BuiltinAgentName
  if (agentName === "sisyphus") continue
  if (agentName === "hephaestus") continue
  if (agentName === "atlas") continue
  if (disabledAgents.some((name) => name.toLowerCase() === agentName.toLowerCase())) continue
  // ...
}
```
- Purpose: Hard-coded exclusions and built-in-only typing in the main registry loop.
- Modify: Replace explicit name checks with metadata flags (e.g., `isPrimaryAgent`) and allow custom agents to opt into the loop.

### createBuiltinAgents per-agent special behavior
- Path: `src/agents/utils.ts`
- Pattern:
```ts
if (agentName === "librarian") {
  config = applyEnvironmentContext(config, directory)
}
```
- Purpose: Special-case behavior for one agent by name.
- Modify: Move to per-agent config metadata flag (e.g., `injectEnvContext: true`).

### Agent display names registry
- Path: `src/shared/agent-display-names.ts`
- Pattern:
```ts
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  sisyphus: "Sisyphus (Ultraworker)",
  atlas: "Atlas (Plan Execution Orchestrator)",
  prometheus: "Prometheus (Plan Builder)",
  "sisyphus-junior": "Sisyphus-Junior",
  metis: "Metis (Plan Consultant)",
  momus: "Momus (Plan Reviewer)",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "multimodal-looker": "multimodal-looker",
}
```
- Purpose: Hard-coded map of agent display names for UI/logs.
- Modify: Allow plugin/custom agent display names (e.g., merge from config/metadata).

### Agent model requirements registry
- Path: `src/shared/model-requirements.ts`
- Pattern:
```ts
export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: { fallbackChain: [...] },
  hephaestus: { fallbackChain: [...], requiresModel: "gpt-5.2-codex" },
  oracle: { fallbackChain: [...] },
  librarian: { fallbackChain: [...] },
  explore: { fallbackChain: [...] },
  "multimodal-looker": { fallbackChain: [...] },
  prometheus: { fallbackChain: [...] },
  metis: { fallbackChain: [...] },
  momus: { fallbackChain: [...] },
  atlas: { fallbackChain: [...] },
}
```
- Purpose: Central model fallback list keyed by agent name; used in creation/validation.
- Modify: Allow dynamic extension (e.g., config-driven requirements) and avoid hard-coded keys by merging defaults with user-registered agents.

## Tool Access / Delegation Gating

### ALLOWED_AGENTS for call_omo_agent
- Path: `src/tools/call-omo-agent/constants.ts`
- Pattern:
```ts
export const ALLOWED_AGENTS = ["explore", "librarian"] as const
```
- Purpose: Whitelist for which agents `call_omo_agent` can spawn.
- Modify: Replace with registry-driven list or config allowlist.

### call_omo_agent validation gate
- Path: `src/tools/call-omo-agent/tools.ts`
- Pattern:
```ts
if (![...ALLOWED_AGENTS].some(
  (name) => name.toLowerCase() === args.subagent_type.toLowerCase()
)) {
  return `Error: Invalid agent type "${args.subagent_type}"...`
}
```
- Purpose: Enforces ALLOWED_AGENTS at runtime.
- Modify: Validate against dynamic registry or config allowlist; keep case-insensitive normalization.

### Task tool gating for explore/librarian
- Path: `src/index.ts`
- Pattern:
```ts
const isExploreOrLibrarian = ["explore", "librarian"].some(
  (name) => name.toLowerCase() === (subagentType ?? "").toLowerCase()
)
args.tools = {
  ...(args.tools as Record<string, boolean> | undefined),
  delegate_task: false,
  ...(isExploreOrLibrarian ? { call_omo_agent: false } : {}),
}
```
- Purpose: Disables `call_omo_agent` when the task tool is used by explore/librarian.
- Modify: Replace with metadata-driven restrictions (e.g., per-agent tool denylist) instead of hard-coded names.

### Agent tool restrictions registry
- Path: `src/shared/agent-tool-restrictions.ts`
- Pattern:
```ts
const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: { write: false, edit: false, task: false, delegate_task: false, call_omo_agent: false },
  librarian: { write: false, edit: false, task: false, delegate_task: false, call_omo_agent: false },
  oracle: { write: false, edit: false, task: false, delegate_task: false },
  "multimodal-looker": { read: true },
  "sisyphus-junior": { task: false, delegate_task: false },
}
```
- Purpose: Hard-coded agent name denylist/allowlist used for permission gating.
- Modify: Merge per-agent tool restrictions from config/metadata and default to empty for unknown agents.

### Plan-agent gating
- Path: `src/tools/delegate-task/constants.ts`
- Pattern:
```ts
export const PLAN_AGENT_NAMES = ["plan", "prometheus", "planner"]
export function isPlanAgent(agentName: string | undefined): boolean {
  const lowerName = agentName.toLowerCase().trim()
  return PLAN_AGENT_NAMES.some(name => lowerName === name || lowerName.includes(name))
}
```
- Purpose: Identifies plan agents by name; used to restrict plan→plan delegation.
- Modify: Drive from agent metadata (role/category), not string matching.

### Sisyphus-Junior direct-call block
- Path: `src/tools/delegate-task/executor.ts`
- Pattern:
```ts
if (agentName.toLowerCase() === SISYPHUS_JUNIOR_AGENT.toLowerCase()) {
  return { error: `Cannot use subagent_type="${SISYPHUS_JUNIOR_AGENT}" directly...` }
}
```
- Purpose: Prevents direct delegation to the category-spawned agent.
- Modify: Replace with a flag on agent registration (e.g., `callable: false`).

### Prometheus read-only gating
- Path: `src/hooks/prometheus-md-only/constants.ts`
- Pattern:
```ts
export const PROMETHEUS_AGENTS = ["prometheus"]
```
- Purpose: Limits the read-only planner hook to a hard-coded agent name.
- Modify: Use agent metadata role (planner) or a config allowlist for read-only enforcement.

## Additional Notes

- Any code using `BuiltinAgentName` or `AgentName` types in signatures is implicitly gated to known names.
- Tests and CLI utilities referencing `AGENT_MODEL_REQUIREMENTS` will also require updates if dynamic agent registration is added.
