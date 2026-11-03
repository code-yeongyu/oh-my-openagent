/**
 * One `{id, kind, state, detail?}` row per thing a setup source found, built from the stage plan
 * the summary renders. Rows travel over RPC, so they carry ids and states only: never a key.
 */

const MODEL_CHOICE_STATES = { pending: "import", kept: "exists", carried: "carried", blocked: "blocked" }

function rows(ids, kind, state) {
  return ids.map((id) => ({ id, kind, state }))
}

function detectItems(inventory) {
  return inventory.harnesses
    .filter((harness) => harness.installed)
    .map((harness) => ({ id: harness.id, kind: "harness", state: "found", detail: `${harness.entryCount} login(s), ${harness.importableCount} importable` }))
}

function providerItems(plan) {
  const { result } = plan
  return [
    ...result.added.map((provider) => ({ id: provider.id, kind: "provider", state: "import", detail: `${provider.config.models.length} model(s)` })),
    ...rows(result.skippedExisting, "provider", "exists"),
    ...rows(result.blocked, "provider", "blocked"),
    ...rows(plan.skipped, "provider", "skipped"),
  ]
}

function credentialItems(plan) {
  if (plan.malformed) return []
  const { result, guidance } = plan
  return [
    ...result.additions.map((item) => ({ id: item.provider, kind: "api-key", state: "import", detail: `from ${item.source}` })),
    ...rows(result.skippedExisting, "api-key", "exists"),
    ...guidance.logins.map((login) => ({ id: login.provider, kind: "oauth", state: login.state, ...(login.target === undefined ? {} : { detail: `/login ${login.target}` }) })),
    ...rows(result.skippedUnmapped, "api-key", "unmapped"),
  ]
}

function assetItems({ result }) {
  return [
    ...result.servers.added.map((server) => ({ id: server.name, kind: "mcp", state: "import" })),
    ...rows(result.servers.skippedExisting, "mcp", "exists"),
    ...rows(result.servers.blocked, "mcp", "blocked"),
    ...result.skills.added.map((skill) => ({ id: skill.name, kind: "skill", state: "import" })),
    ...rows(result.skills.skippedExisting, "skill", "exists"),
    ...rows(result.skills.skippedBundled, "skill", "bundled"),
  ]
}

function modelChoiceItems(plan) {
  return plan.items.map((item) => ({ id: item.label, kind: item.kind, state: MODEL_CHOICE_STATES[item.state] ?? item.state }))
}

const ITEMS_BY_SOURCE = {
  detect: detectItems,
  providers: providerItems,
  credentials: credentialItems,
  assets: assetItems,
  "model-choices": modelChoiceItems,
}

export function setupStageItems(source, plan) {
  return ITEMS_BY_SOURCE[source](plan)
}
