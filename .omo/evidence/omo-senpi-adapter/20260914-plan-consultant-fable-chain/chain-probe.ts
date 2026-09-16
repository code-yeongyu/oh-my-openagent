
const REPO = process.argv[2]
const { BUILTIN_AGENTS } = await import(`${REPO}/packages/senpi-task/src/agents/builtin/index.ts`)
const { resolveAgent } = await import(`${REPO}/packages/senpi-task/src/agents/resolve-agent.ts`)
const model = (provider: string, id: string) => ({ provider, id })
const registry = (models: readonly { provider: string; id: string }[]) => ({
  getAvailable: () => models,
  find: (provider: string, modelId: string) => models.find((m) => m.provider === provider && m.id === modelId),
})
const scenarios = {
  "claude-subscriber(claude-sdk-oauth+opencode)": registry(["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-sonnet-4-6"].flatMap((id) => [model("opencode", id), model("claude-sdk-oauth", id)])),
  "copilot-only": registry([model("github-copilot", "claude-opus-5"), model("github-copilot", "gpt-6-astra"), model("github-copilot", "claude-haiku-4-5")]),
  "kimi-only": registry([model("kimi-for-coding", "kimi-k3")]),
  "no-chain-model": registry([model("openai", "gpt-5.4-nano")]),
}
const out: Record<string, unknown> = {}
for (const [scenario, reg] of Object.entries(scenarios)) {
  for (const name of ["plan-consultant", "explore", "librarian", "plan-reviewer"]) {
    const r = resolveAgent(name, BUILTIN_AGENTS, reg)
    const { instructions, ...rest } = r as Record<string, unknown>
    out[`${scenario} :: ${name}`] = rest.kind === "resolved"
      ? { kind: rest.kind, model: rest.model, variant: (rest.resolved_model as { variant?: string } | undefined)?.variant ?? rest.variant, fallback: (rest.fallback_models as { display: string }[] | undefined)?.map((m) => m.display) }
      : { kind: rest.kind, attempted: rest.attemptedModel ?? rest.attempted_model, reason: rest.reason }
  }
}
console.log(JSON.stringify(out, null, 2))
