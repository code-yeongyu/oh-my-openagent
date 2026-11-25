/**
 * The one migration summary `omo setup` prints before its one consent: what was found, per class
 * (logins, MCP servers, skills, custom providers, model choices), and what happens to each item.
 * Pure: it renders the detect inventory and the stage plans, and reads nothing itself.
 */

import { isAbsolute, join, relative } from "node:path"
import { coverageSummaryItems, gapLine } from "./category-coverage.js"
import { commandCodeGuidance } from "./setup-guidance.js"
import { formatModelTemplate, MODEL_GUIDE_LINE } from "./setup-models.js"
import { providerKeySource } from "./setup-providers-import.js"
import { COMMANDCODE_PROVIDER_ID } from "./setup-commandcode.js"

// The installers' disclosure (TELEMETRY_INSTALL_DISCLOSURE_LINES in telemetry-core), word for word: a
// bare `bun add -g omo-ai` user never runs an installer, so setup is where they see it.
export const TELEMETRY_NOTICE = [
  "OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.",
  "The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).",
  "Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).",
  "Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md",
].join("\n")

const LABEL_WIDTH = 14
const SOURCE_HARNESSES = { opencode: "OpenCode", "oh-my-pi": "oh-my-pi", "gajae-code": "gajae-code" }

function count(n, noun, plural = `${noun}s`) {
  return `${n} ${n === 1 ? noun : plural}`
}

export function displayPath(path, home) {
  const inside = relative(home, path)
  if (inside === "") return "~"
  return inside.startsWith("..") || isAbsolute(inside) ? path : `~/${inside}`
}

function row(label, parts) {
  return parts.map((part, index) => `  ${(index === 0 ? label : "").padEnd(LABEL_WIDTH)}${part}`)
}

/**
 * One phrase of the summary, built from its typed fields only. Every item and part the summary answers carries its
 * text from this function, so a caller reads the fields and the command prints the text.
 * @param {SummaryItem} item
 * @returns {string}
 */
export function summaryPhrase(item) {
  const names = (ids) => ids.join(", ")
  const reasons = (items) => items.map((entry) => `${entry.id}: ${entry.reason}`).join(", ")
  switch (item.class) {
    case "logins":
      switch (item.state) {
        case "store_malformed":
          return `${count(item.count, "login")} found - not imported: omo's auth.json is malformed (see notes)`
        case "will_import":
          return `${count(item.count, "API key")} (${item.keys.map((key) => (key.source === "opencode" ? key.provider : `${key.provider} from ${key.source}`)).join(", ")}) - will be imported`
        case "already_present":
          return `${count(item.count, "API key")} omo already has (${names(item.ids)}) - kept as is`
        case "sign_in_again":
          return `${count(item.count, "OAuth login")} (${names(item.ids)}) - sign in again inside omo: ${item.commands
            .map((command) =>
              command.providers.every((provider) => provider === command.target)
                ? `/login ${command.target}`
                : `/login ${command.target} (for ${command.providers.join(", ")})`,
            )
            .join(", ")}`
        case "signed_in":
          return `${count(item.count, "OAuth login")} (${names(item.ids)}) - already signed in inside omo`
        case "no_provider":
          return `${count(item.count, "OAuth login")} (${names(item.ids)}) - omo has no provider for it; keep using the other agent for it`
        case "unserved":
          return `${count(item.count, "API key")} for providers omo does not serve (${names(item.ids)}) - define the provider and its baseUrl in ${item.models_path}, then /login <provider> inside omo`
      }
      break
    case "mcp_servers":
    case "skills":
      switch (item.state) {
        case "will_import":
          return `${item.count} will be imported (${names(item.ids)})`
        case "refused":
          return `${item.count} refused (${reasons(item.reasons)})`
        case "skipped":
          return `${item.count} skipped (${reasons(item.reasons)})`
        case "already_present":
          return `${item.count} omo already has (${names(item.ids)})`
        case "bundled":
          return `${item.count} bundled with omo (${names(item.ids)})`
        case "store_malformed":
          return `${item.count} not imported: omo's mcp.json is malformed (${names(item.ids)})`
      }
      break
    case "providers":
      switch (item.state) {
        case "will_import":
          return `${item.id} -> ${item.base_url}, ${count(item.models.length, "model")} (${item.models.join(", ")}), ${keySourcePhrase(item)} - will be imported`
        case "already_present":
          return `${item.count} already in omo's models.json (${names(item.ids)}) - kept as is`
        case "store_malformed":
          return `${item.count} not imported: omo's models.json is malformed (${names(item.ids)})`
        case "not_carried":
          return `${item.count} not carried (${names(item.ids)}) - see notes`
      }
      break
    case "model_choices":
      switch (item.state) {
        case "will_write":
          return `${[
            ...(item.default_ref === undefined ? [] : [`default ${item.default_ref}`]),
            ...(item.categories.length > 0 ? [`categories ${item.categories.join(", ")}`] : []),
            ...(item.agents.length > 0 ? [`agents ${item.agents.join(", ")}`] : []),
          ].join("; ")} - will be written`
        case "kept":
          return `${item.count} you already set differently in omo (${names(item.ids)}) - kept as is`
        case "carried":
          return `${item.count} already carried (${names(item.ids)})`
        case "blocked":
          return `${item.count} not written (${names(item.ids)}) - see notes`
        case "dropped":
          return `${item.count} not carried - see notes`
      }
      break
    case "categories":
      switch (item.state) {
        case "all_usable":
          return `all ${item.count} usable with these providers`
        case "usable":
          return `${item.count} of ${item.total} usable with these providers${item.ids.length > 0 ? ` (${names(item.ids)})` : ""}`
        case "unavailable":
          return gapLine({
            name: item.id,
            providers: item.providers,
            ...(item.unlisted_provider_model === undefined
              ? {}
              : { unlistedProviderModel: item.unlisted_provider_model }),
          })
      }
  }
  throw new Error(`no phrase for ${item.class}/${item.state}`)
}

/** @param {{ key_source: string, key_from?: string, id: string }} item */
function keySourcePhrase(item) {
  if (item.key_source === "kept_existing") return "kept the existing auth.json key"
  if (item.key_source === "store_malformed") return "key not imported (malformed auth.json)"
  if (item.key_source === "found") return `key from ${item.key_from}`
  return `no key found - /login ${item.id} inside omo`
}

/** A summary line: its typed items and the text they render to, items of one line joined by "; ". */
function summaryPart(items) {
  const phrased = items.map((item) => ({ ...item, text: summaryPhrase(item) }))
  return { items: phrased, text: phrased.map((item) => item.text).join("; ") }
}

/** Each item on its own line (logins, providers' additions, categories); segments on one line (the rest). */
const own = (items) => items.map((item) => summaryPart([item]))
const joined = (items) => (items.length > 0 ? [summaryPart(items)] : [])
const some = (list) => list.filter((item) => (item.ids ?? item.reasons ?? [true]).length > 0 && item.count !== 0)

function loginItems({ credentials, agentDir, home }) {
  if (credentials.malformed)
    return credentials.found > 0
      ? [{ class: "logins", kind: "login", state: "store_malformed", count: credentials.found }]
      : []
  const { result, guidance } = credentials
  const items = []
  if (result.additions.length > 0)
    items.push({
      class: "logins",
      kind: "api_key",
      state: "will_import",
      count: result.additions.length,
      keys: result.additions.map((item) => ({ provider: item.provider, source: item.source })),
    })
  if (result.skippedExisting.length > 0)
    items.push({
      class: "logins",
      kind: "api_key",
      state: "already_present",
      count: result.skippedExisting.length,
      ids: result.skippedExisting,
    })
  const byState = (state) => guidance.logins.filter((login) => login.state === state)
  const login = byState("login")
  if (login.length > 0) {
    // One command per omo provider, naming the logins it replaces when their id differs.
    const targets = new Map()
    for (const item of login) targets.set(item.target, [...(targets.get(item.target) ?? []), item.provider])
    items.push({
      class: "logins",
      kind: "oauth_login",
      state: "sign_in_again",
      count: login.length,
      ids: login.map((item) => item.provider),
      commands: [...targets].map(([target, providers]) => ({ target, providers })),
    })
  }
  for (const state of /** @type {const} */ (["signed-in", "unsupported"])) {
    const matched = byState(state)
    if (matched.length > 0)
      items.push({
        class: "logins",
        kind: "oauth_login",
        state: state === "signed-in" ? "signed_in" : "no_provider",
        count: matched.length,
        ids: matched.map((item) => item.provider),
      })
  }
  if (guidance.unmapped.length > 0)
    items.push({
      class: "logins",
      kind: "api_key",
      state: "unserved",
      count: guidance.unmapped.length,
      ids: guidance.unmapped,
      models_path: displayPath(join(agentDir, "models.json"), home),
    })
  return own(items)
}

const reasonsOf = (items) => items.map((item) => ({ id: item.name, reason: item.reason }))

function mcpItems({ assets }) {
  const { servers } = assets.result
  const kind = "mcp_server"
  return joined(
    some([
      {
        class: "mcp_servers",
        kind,
        state: "will_import",
        count: servers.added.length,
        ids: servers.added.map((item) => item.name),
      },
      {
        class: "mcp_servers",
        kind,
        state: "refused",
        count: assets.refusedServers.length,
        reasons: reasonsOf(assets.refusedServers),
      },
      {
        class: "mcp_servers",
        kind,
        state: "already_present",
        count: servers.skippedExisting.length,
        ids: servers.skippedExisting,
      },
      { class: "mcp_servers", kind, state: "store_malformed", count: servers.blocked.length, ids: servers.blocked },
    ]),
  )
}

function skillItems({ assets }) {
  const { skills } = assets.result
  const kind = "skill"
  return joined(
    some([
      {
        class: "skills",
        kind,
        state: "will_import",
        count: skills.added.length,
        ids: skills.added.map((item) => item.name),
      },
      {
        class: "skills",
        kind,
        state: "skipped",
        count: assets.skippedSkills.length,
        reasons: reasonsOf(assets.skippedSkills),
      },
      {
        class: "skills",
        kind,
        state: "already_present",
        count: skills.skippedExisting.length,
        ids: skills.skippedExisting,
      },
      { class: "skills", kind, state: "bundled", count: skills.skippedBundled.length, ids: skills.skippedBundled },
    ]),
  )
}

function providerItems({ providers }) {
  const { result } = providers
  const kind = "provider"
  const added = result.added.map((provider) => ({
    class: "providers",
    kind,
    state: "will_import",
    id: provider.id,
    base_url: provider.config.baseUrl,
    models: provider.config.models.map((model) => model.id),
    ...providerKeySource(provider, result),
  }))
  return [
    ...own(added),
    ...joined(
      some([
        {
          class: "providers",
          kind,
          state: "already_present",
          count: result.skippedExisting.length,
          ids: result.skippedExisting,
        },
        { class: "providers", kind, state: "store_malformed", count: result.blocked.length, ids: result.blocked },
        { class: "providers", kind, state: "not_carried", count: providers.skipped.length, ids: providers.skipped },
      ]),
    ),
  ]
}

function modelChoiceItems({ modelChoices }) {
  const pending = modelChoices.items.filter((item) => item.state === "pending")
  const named = (kind) => pending.filter((item) => item.kind === kind).map((item) => item.name)
  const labels = (state) => modelChoices.items.filter((item) => item.state === state).map((item) => item.label)
  const kind = "model_choice"
  const chosen = {
    class: "model_choices",
    kind,
    state: "will_write",
    ...(pending.some((item) => item.kind === "default") ? { default_ref: modelChoices.defaultModel.ref } : {}),
    categories: named("categories"),
    agents: named("agents"),
  }
  return [
    ...(chosen.default_ref !== undefined || chosen.categories.length > 0 || chosen.agents.length > 0
      ? own([chosen])
      : []),
    ...joined(
      some([
        { class: "model_choices", kind, state: "kept", count: labels("kept").length, ids: labels("kept") },
        { class: "model_choices", kind, state: "carried", count: labels("carried").length, ids: labels("carried") },
        { class: "model_choices", kind, state: "blocked", count: labels("blocked").length, ids: labels("blocked") },
        { class: "model_choices", kind, state: "dropped", count: modelChoices.dropped.length },
      ]),
    ),
  ]
}

// The harnesses setup reads from, only the installed ones. OpenCode also counts as found when only
// its config (MCP servers, skills, providers, model choices) exists and it never stored a login.
function sourceIds(context) {
  const installed = new Set(
    context.inventory.harnesses.filter((harness) => harness.installed).map((harness) => harness.id),
  )
  const { assets, providers, modelChoices } = context
  const configFound =
    assets.present ||
    assets.refusedServers.length > 0 ||
    assets.skippedSkills.length > 0 ||
    providers.present ||
    providers.skipped.length > 0 ||
    modelChoices.present
  if (configFound) installed.add("opencode")
  const ids = Object.keys(SOURCE_HARNESSES).filter((id) => installed.has(id))
  return providers.result.added.some((provider) => provider.origin === "commandcode") ? [...ids, "commandcode"] : ids
}

// Every stage notice once. Of the detect notices only omo's own store is added: the credential
// stage re-reads every source store and reports its own failures in the same words.
function noteItems(context) {
  const detect = context.inventory.harnesses
    .filter((harness) => harness.installed && !Object.hasOwn(SOURCE_HARNESSES, harness.id))
    .flatMap((harness) =>
      harness.notices.map((notice) => ({
        code: "detect",
        text: `${notice.startsWith("could not") ? "WARN" : "NOTICE"} ${harness.id}: ${notice}`,
      })),
    )
  const stages = [
    ["credentials", context.credentials],
    ["assets", context.assets],
    ["providers", context.providers],
    ["model_choices", context.modelChoices],
  ].flatMap(([code, stage]) => stage.notices.map((text) => ({ code, text })))
  const seen = new Set()
  return [...detect, ...stages].filter((note) => !seen.has(note.text) && seen.add(note.text))
}

const CLASS_LABELS = {
  logins: "logins",
  mcp_servers: "MCP servers",
  skills: "skills",
  providers: "providers",
  model_choices: "model choices",
  categories: "categories",
}

/**
 * What `omo setup` found, as data: sources, one row per class with its typed items and their phrases, coverage, notes
 * with their origin. Holds no stage plan, no file bytes and no key.
 * `context`: `{ home, agentDir, inventory, credentials, assets, providers, modelChoices, categories? }`.
 */
export function setupSummary(context) {
  const rows = [
    { class: "logins", parts: loginItems(context) },
    { class: "mcp_servers", parts: mcpItems(context) },
    { class: "skills", parts: skillItems(context) },
    { class: "providers", parts: providerItems(context) },
    { class: "model_choices", parts: modelChoiceItems(context) },
  ].filter((entry) => entry.parts.length > 0)
  return {
    sources: sourceIds(context),
    rows,
    ...(context.categories === undefined ? {} : { coverage: own(coverageSummaryItems(context.categories)) }),
    notes: noteItems(context),
    // The Command Code guidance speaks to a user the plan already has a Command Code stake for: the
    // key env var is set (the preset is on its way into models.json) or an entry the plan carries or
    // refused is already there. A user with neither sees no Command Code guidance at all.
    command_code_planned:
      context.providers.result.added.some((item) => item.id === COMMANDCODE_PROVIDER_ID) ||
      context.providers.skipped.includes(COMMANDCODE_PROVIDER_ID),
  }
}

/** The summary as `omo setup` prints it: it only joins the phrases the summary carries. */
export function renderSetupSummary(summary) {
  const names = summary.sources.map((id) => (id === "commandcode" ? "Command Code" : SOURCE_HARNESSES[id]))
  const lines = [names.length > 0 ? `Found your ${names.join(" and ")} setup` : "No OpenCode setup found"]
  const rows = summary.rows.flatMap((entry) =>
    row(
      CLASS_LABELS[entry.class],
      entry.parts.map((part) => part.text),
    ),
  )
  if (rows.length > 0) lines.push(...rows)
  else lines.push("  nothing omo can import")
  // Coverage is not something found, so it never turns an empty summary into a non-empty one.
  if (summary.coverage !== undefined)
    lines.push(
      ...row(
        CLASS_LABELS.categories,
        summary.coverage.map((part) => part.text),
      ),
    )
  if (summary.notes.length > 0) lines.push("Notes:", ...summary.notes.map((note) => `  ${note.text}`))
  lines.push(...(summary.command_code_planned ? commandCodeGuidance() : []))
  lines.push(MODEL_GUIDE_LINE)
  if (rows.length === 0) lines.push(...formatModelTemplate())
  return `${lines.join("\n")}\n`
}

/** The summary text straight from a scan's context (setupSummary, then renderSetupSummary). */
export function formatSetupSummary(context) {
  return renderSetupSummary(setupSummary(context))
}
