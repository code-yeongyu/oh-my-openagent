/**
 * The detection and planning half of `omo setup` as one stream: each source is read, classified
 * and yielded on its own, in the order later sources depend on. `omo setup` and the engine's
 * onboarding scan RPC (omo-senpi `components/onboarding/scan-runtime.ts`) both consume it, so the
 * import logic exists once. Nothing is written until a caller hands the collected plans to
 * `applySetupStages`. No source opens a socket or calls a model: the model-choice stage reads the
 * engine's offline model catalog only.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { detectHarnesses } from "./setup-detect.js"
import { applyCredentials, credentialCounts, credentialPlanLines, credentialQuestion, opencodeOauthProviders, planCredentials } from "./setup-credentials.js"
import { applyAssets, assetCounts, assetPlanLines, assetQuestion, planAssets } from "./setup-assets-import.js"
import { planOpencodeProviders } from "./setup-opencode-providers.js"
import { applyProviders, planProviders, providerCounts, providerPlanLines, providerQuestion } from "./setup-providers-import.js"
import { applyModelChoices, modelChoiceCounts, modelChoicePlanLines, modelChoiceQuestion, planModelChoices } from "./setup-model-choices-import.js"
import { setupStageItems } from "./setup-stream-items.js"

export { canonicalAgentDir } from "./agent-dir.js"

/** Every source, in stream order: a later source reads what an earlier one decided. */
export const SETUP_SOURCES = ["detect", "providers", "credentials", "assets", "model-choices"]

const NO_PROVIDERS = { providers: [], skipped: [], notices: [] }

async function settle(work) {
  try {
    return { plan: await work() }
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }
}

function stageResult(source, settled, disabled = false) {
  if (settled.error !== undefined) return { source, items: [], notices: [], plan: { pending: 0 }, error: settled.error }
  const plan = settled.plan
  return { source, items: disabled ? [] : setupStageItems(source, plan), notices: plan.notices ?? [], plan, ...(disabled ? { disabled: true } : {}) }
}

/**
 * Streams every source's plan. Custom providers (OpenCode `provider.<id>` blocks and catalog
 * providers) are read only with `includeCustomProviders`; without it the provider stage yields
 * disabled and empty, and a key for such a provider stays unmapped. `onSourceStart` is called
 * right before an enabled source starts reading. A source that throws yields its `error` and the
 * stream goes on with the sources after it.
 */
export async function* scanSetup(runtime, agentDir, options = {}) {
  const includeCustomProviders = options.includeCustomProviders === true
  const start = (source) => options.onSourceStart?.(source)

  start("detect")
  const detect = await settle(() => detectHarnesses(runtime))
  yield stageResult("detect", detect)

  if (includeCustomProviders) start("providers")
  let providerSource = NO_PROVIDERS
  const providers = await settle(() => {
    if (includeCustomProviders) providerSource = planOpencodeProviders(runtime)
    return planProviders(providerSource, agentDir)
  })
  if (providers.error !== undefined) providerSource = NO_PROVIDERS
  yield stageResult("providers", providers, !includeCustomProviders)

  start("credentials")
  // A provider the custom-provider stage described (carried or refused with its reason) is reported there only.
  const described = new Set([...providerSource.providers.map((item) => item.id), ...providerSource.skipped])
  yield stageResult("credentials", await settle(() => planCredentials(runtime, join(agentDir, "auth.json"), described)))

  start("assets")
  yield stageResult("assets", await settle(() => planAssets({ runtime, agentDir })))

  start("model-choices")
  let planChoices
  const modelChoices = await settle(() => {
    const oauthProviders = opencodeOauthProviders(runtime)
    planChoices = (customProviders) => planModelChoices({ runtime, agentDir, customProviders, oauthProviders })
    return planChoices(providers.plan?.result.added ?? [])
  })
  yield { ...stageResult("model-choices", modelChoices), ...(planChoices === undefined ? {} : { replan: planChoices }) }
}

/**
 * Drains a stream into the detect inventory and the stage plans `omo setup` renders and applies.
 * The CLI cannot summarize a partial plan, so the first failed source is rethrown.
 */
export async function collectSetupPlans(stream) {
  const plans = {}
  let inventory = { harnesses: [] }
  for await (const result of stream) {
    if (result.error !== undefined) throw result.error
    if (result.source === "detect") inventory = result.plan
    else if (result.source === "model-choices") {
      plans.modelChoices = result.plan
      plans.planChoices = result.replan
    } else plans[result.source] = result.plan
  }
  return { inventory, plans }
}

/**
 * In apply order: the model-choice stage runs last because a default model or category may name a
 * custom provider the stage before it carries. `present` stages report counts after the run. A
 * stage whose source failed has no plan and is never applied.
 */
export function setupStages(plans) {
  return [
    { id: "credentials", plan: plans.credentials, present: plans.credentials !== undefined && !plans.credentials.malformed, lines: credentialPlanLines, counts: credentialCounts, question: credentialQuestion, apply: (plan, options) => applyCredentials(plan, options) },
    { id: "assets", plan: plans.assets, present: plans.assets?.present === true, lines: assetPlanLines, counts: assetCounts, question: assetQuestion, apply: (plan) => applyAssets(plan) },
    { id: "providers", plan: plans.providers, present: plans.providers?.present === true, lines: providerPlanLines, counts: providerCounts, question: providerQuestion, apply: (plan, options) => applyProviders(plan, options) },
    { id: "model-choices", plan: plans.modelChoices, present: plans.modelChoices?.present === true, lines: modelChoicePlanLines, counts: modelChoiceCounts, question: modelChoiceQuestion, apply: (plan, options) => applyModelChoices(plan, options) },
  ]
}

/** Thrown by `applySetupStages` when its `staleGuard` finds a target that changed since planning. */
export class SetupStaleError extends Error {
  constructor(paths, applied) {
    super(`setup targets changed since planning: ${paths.join(", ")}`)
    this.name = "SetupStaleError"
    this.paths = paths
    this.applied = applied
  }
}

// Every plan holds the bytes its target had when it was read. A target whose content hash no longer
// matches would be overwritten with the scan-time copy, so it counts as stale; an absent file is its
// own expected state, and mtime alone never decides anything.
function targetDigest(bytes) {
  return createHash("sha256").update(bytes === undefined ? "\0absent" : bytes).digest("hex")
}

function staleTarget(path, expectedBytes) {
  let current
  try {
    current = readFileSync(path, "utf8")
  } catch {
    current = undefined
  }
  return targetDigest(current) !== targetDigest(expectedBytes)
}

// A skill directory planned as new is stale once anything exists at its path: it is a directory, so
// reading it as a file would always look absent (#10496 review).
function staleAbsentPath(path) {
  return existsSync(path)
}

/**
 * The target paths of the given stages whose content changed since their plans read them. Paths in
 * `written` were rewritten by an earlier stage of the same apply (the credentials stage and the
 * provider keys share auth.json), so they are not the user's change and do not count (#10496 review).
 */
export function staleSetupTargets(plans, stageIds, written = new Set()) {
  const changed = new Set()
  const mark = (path, expectedBytes) => {
    if (written.has(resolve(path))) return
    if (staleTarget(path, expectedBytes)) changed.add(path)
  }
  const markAbsent = (path) => {
    if (written.has(resolve(path))) return
    if (staleAbsentPath(path)) changed.add(path)
  }
  for (const id of stageIds) {
    if (id === "credentials") {
      const plan = plans.credentials
      if (plan === undefined || plan.malformed || plan.pending === 0) continue
      mark(plan.target, plan.current?.bytes)
    } else if (id === "assets") {
      const plan = plans.assets
      if (plan?.present !== true || plan.pending === 0) continue
      if (plan.result.target.malformed !== true) mark(plan.paths.mcp, plan.result.target.bytes)
      for (const skill of plan.result.skills.added) markAbsent(join(plan.paths.skills, skill.name))
    } else if (id === "providers") {
      const plan = plans.providers
      if (plan?.present !== true || plan.pending === 0) continue
      if (plan.models.malformed !== true) mark(plan.paths.models, plan.models.bytes)
      if ((plan.result.keys?.length ?? 0) > 0) mark(plan.paths.auth, plan.authBytes)
    } else if (id === "model-choices") {
      const plan = plans.modelChoices
      if (plan?.present !== true || plan.pending === 0) continue
      for (const item of plan.items) {
        if (item.state === "pending" && item.target.malformed !== true) mark(item.target.path, item.target.text)
      }
    }
  }
  return [...changed]
}

/** The files a stage writes when it applies (resolved), so later stages of one apply can tell them apart. */
function stageWrittenPaths(plans, id) {
  if (id === "credentials") return plans.credentials?.target === undefined ? [] : [plans.credentials.target]
  if (id === "assets") return plans.assets?.paths?.mcp === undefined ? [] : [plans.assets.paths.mcp, ...(plans.assets.result?.skills?.added ?? []).map((skill) => join(plans.assets.paths.skills, skill.name))]
  if (id === "providers") return [plans.providers?.paths?.models, plans.providers?.paths?.auth].filter((path) => path !== undefined)
  if (id === "model-choices") return (plans.modelChoices?.items ?? []).map((item) => item.target?.path).filter((path) => path !== undefined)
  return []
}

/** True when any of the given stages would write into a credential store. */
export function authWritesPending(plans, stageIds) {
  const ids = new Set(stageIds)
  const credentials = ids.has("credentials") && plans.credentials !== undefined && !plans.credentials.malformed && plans.credentials.pending > 0
  const keys = ids.has("providers") && plans.providers !== undefined && (plans.providers.result?.keys?.length ?? 0) > 0
  return credentials || keys
}

/**
 * Applies every stage `confirm` accepts and returns the ids it applied. A declined provider stage
 * leaves models.json as it is, so the model choices are re-planned against it rather than against
 * providers that will not exist; the notices that re-plan adds go to `report`. `options.writeAuth`
 * routes credential additions through a locked credential store instead of the CLI's direct writer,
 * and `options.staleGuard`, re-checked right before each write, refuses a stage whose target
 * changed since planning by throwing `SetupStaleError`.
 */
export async function applySetupStages(plans, confirm, report = () => {}, options = {}) {
  const applied = new Set()
  // Files this apply already rewrote: a later stage's stale check must not mistake them for a
  // user's change (the credentials stage and the provider keys share auth.json; #10496 review).
  const written = new Set()
  for (const stage of setupStages(plans)) {
    if (stage.id === "model-choices" && stage.plan !== undefined && plans.planChoices !== undefined && (plans.providers?.pending ?? 0) > 0 && !applied.has("providers")) {
      const shown = new Set(plans.modelChoices.notices)
      plans.modelChoices = await plans.planChoices([])
      stage.plan = plans.modelChoices
      for (const notice of plans.modelChoices.notices) if (!shown.has(notice)) report(notice)
    }
    if (stage.plan === undefined || stage.plan.pending === 0) continue
    if (!await confirm(stage)) continue
    if (options.staleGuard !== undefined) {
      const stale = options.staleGuard(stage.id, written)
      if (stale !== undefined && stale.length > 0) throw new SetupStaleError(stale, [...applied])
    }
    await stage.apply(stage.plan, { ...options, report })
    applied.add(stage.id)
    for (const path of stageWrittenPaths(plans, stage.id)) written.add(resolve(path))
  }
  return applied
}
