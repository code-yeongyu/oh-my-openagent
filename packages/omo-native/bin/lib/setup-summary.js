/**
 * The one migration summary `omo setup` prints before its one consent: what was found, per class
 * (logins, MCP servers, skills, custom providers, model choices), and what happens to each item.
 * Pure: it renders the detect inventory and the stage plans, and reads nothing itself.
 */

import { isAbsolute, join, relative } from "node:path"
import { coverageSummaryParts } from "./category-coverage.js"
import { formatModelTemplate, MODEL_GUIDE_LINE } from "./setup-models.js"
import { providerKeySource } from "./setup-providers-import.js"

// The installer's line (omo-opencode cli-installer.ts / tui-installer.ts), word for word: a bare
// `bun add -g omo-ai` user never runs the installer, so setup is where they see it.
export const TELEMETRY_NOTICE = "Anonymous telemetry is enabled by default. Disable it with OMO_SEND_ANONYMOUS_TELEMETRY=0 or OMO_DISABLE_POSTHOG=1."

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

function loginParts({ credentials, agentDir, home }) {
  if (credentials.malformed) return credentials.found > 0 ? [`${count(credentials.found, "login")} found - not imported: omo's auth.json is malformed (see notes)`] : []
  const { result, guidance } = credentials
  const parts = []
  const keyName = (item) => (item.source === "opencode" ? item.provider : `${item.provider} from ${item.source}`)
  if (result.additions.length > 0) parts.push(`${count(result.additions.length, "API key")} (${result.additions.map(keyName).join(", ")}) - will be imported`)
  if (result.skippedExisting.length > 0) parts.push(`${count(result.skippedExisting.length, "API key")} omo already has (${result.skippedExisting.join(", ")}) - kept as is`)
  const byState = (state) => guidance.logins.filter((login) => login.state === state)
  const login = byState("login")
  if (login.length > 0) {
    // One command per omo provider, naming the logins it replaces when their id differs.
    const targets = new Map()
    for (const item of login) targets.set(item.target, [...(targets.get(item.target) ?? []), item.provider])
    const commands = [...targets].map(([target, providers]) => (providers.every((provider) => provider === target) ? `/login ${target}` : `/login ${target} (for ${providers.join(", ")})`))
    parts.push(`${count(login.length, "OAuth login")} (${login.map((item) => item.provider).join(", ")}) - sign in again inside omo: ${commands.join(", ")}`)
  }
  const signedIn = byState("signed-in")
  if (signedIn.length > 0) parts.push(`${count(signedIn.length, "OAuth login")} (${signedIn.map((item) => item.provider).join(", ")}) - already signed in inside omo`)
  const unsupported = byState("unsupported")
  if (unsupported.length > 0) parts.push(`${count(unsupported.length, "OAuth login")} (${unsupported.map((item) => item.provider).join(", ")}) - omo has no provider for it; keep using the other agent for it`)
  if (guidance.unmapped.length > 0) {
    parts.push(`${count(guidance.unmapped.length, "API key")} for providers omo does not serve (${guidance.unmapped.join(", ")}) - define the provider and its baseUrl in ${displayPath(join(agentDir, "models.json"), home)}, then /login <provider> inside omo`)
  }
  return parts
}

function withReasons(items) {
  return items.map((item) => `${item.name}: ${item.reason}`).join(", ")
}

function segments(list) {
  const present = list.filter(([items]) => items.length > 0).map(([items, render]) => render(items))
  return present.length > 0 ? [present.join("; ")] : []
}

function mcpParts({ assets }) {
  const { servers } = assets.result
  return segments([
    [servers.added, (items) => `${items.length} will be imported (${items.map((item) => item.name).join(", ")})`],
    [assets.refusedServers, (items) => `${items.length} refused (${withReasons(items)})`],
    [servers.skippedExisting, (items) => `${items.length} omo already has (${items.join(", ")})`],
    [servers.blocked, (items) => `${items.length} not imported: omo's mcp.json is malformed (${items.join(", ")})`],
  ])
}

function skillParts({ assets }) {
  const { skills } = assets.result
  return segments([
    [skills.added, (items) => `${items.length} will be imported (${items.map((item) => item.name).join(", ")})`],
    [assets.skippedSkills, (items) => `${items.length} skipped (${withReasons(items)})`],
    [skills.skippedExisting, (items) => `${items.length} omo already has (${items.join(", ")})`],
    [skills.skippedBundled, (items) => `${items.length} bundled with omo (${items.join(", ")})`],
  ])
}

function providerParts({ providers }) {
  const { result } = providers
  const added = result.added.map((provider) => {
    const models = provider.config.models.map((model) => model.id)
    return `${provider.id} -> ${provider.config.baseUrl}, ${count(models.length, "model")} (${models.join(", ")}), ${providerKeySource(provider, result)} - will be imported`
  })
  return [
    ...added,
    ...segments([
      [result.skippedExisting, (items) => `${items.length} already in omo's models.json (${items.join(", ")}) - kept as is`],
      [result.blocked, (items) => `${items.length} not imported: omo's models.json is malformed (${items.join(", ")})`],
      [providers.skipped, (items) => `${items.length} not carried (${items.join(", ")}) - see notes`],
    ]),
  ]
}

function modelChoiceParts({ modelChoices }) {
  const pending = modelChoices.items.filter((item) => item.state === "pending")
  const named = (kind) => pending.filter((item) => item.kind === kind).map((item) => item.name)
  const chosen = [
    ...(pending.some((item) => item.kind === "default") ? [`default ${modelChoices.defaultModel.ref}`] : []),
    ...(named("categories").length > 0 ? [`categories ${named("categories").join(", ")}`] : []),
    ...(named("agents").length > 0 ? [`agents ${named("agents").join(", ")}`] : []),
  ]
  const labels = (state) => modelChoices.items.filter((item) => item.state === state).map((item) => item.label)
  return [
    ...(chosen.length > 0 ? [`${chosen.join("; ")} - will be written`] : []),
    ...segments([
      [labels("kept"), (items) => `${items.length} you already set differently in omo (${items.join(", ")}) - kept as is`],
      [labels("carried"), (items) => `${items.length} already carried (${items.join(", ")})`],
      [labels("blocked"), (items) => `${items.length} not written (${items.join(", ")}) - see notes`],
      [modelChoices.dropped, (items) => `${items.length} not carried - see notes`],
    ]),
  ]
}

// The harnesses setup reads from, only the installed ones. OpenCode also counts as found when only
// its config (MCP servers, skills, providers, model choices) exists and it never stored a login.
function sourceNames(context) {
  const installed = new Set(context.inventory.harnesses.filter((harness) => harness.installed).map((harness) => harness.id))
  const { assets, providers, modelChoices } = context
  const configFound = assets.present || assets.refusedServers.length > 0 || assets.skippedSkills.length > 0
    || providers.present || providers.skipped.length > 0 || modelChoices.present
  if (configFound) installed.add("opencode")
  return Object.keys(SOURCE_HARNESSES).filter((id) => installed.has(id)).map((id) => SOURCE_HARNESSES[id])
}

// Every stage notice once. Of the detect notices only omo's own store is added: the credential
// stage re-reads every source store and reports its own failures in the same words.
function notes(context) {
  const detect = context.inventory.harnesses
    .filter((harness) => harness.installed && !Object.hasOwn(SOURCE_HARNESSES, harness.id))
    .flatMap((harness) => harness.notices.map((notice) => `${notice.startsWith("could not") ? "WARN" : "NOTICE"} ${harness.id}: ${notice}`))
  const stages = [context.credentials, context.assets, context.providers, context.modelChoices]
  return [...new Set([...detect, ...stages.flatMap((stage) => stage.notices)])]
}

/**
 * `context`: `{ home, agentDir, inventory, credentials, assets, providers, modelChoices }`, each
 * stage's plan as its `plan*` function returns it, plus `categories`: the task-category coverage of
 * the post-import plan (`setupCoverage`), undefined when it could not be computed.
 */
export function formatSetupSummary(context) {
  // A class with nothing found renders no row.
  const rows = [
    ...row("logins", loginParts(context)),
    ...row("MCP servers", mcpParts(context)),
    ...row("skills", skillParts(context)),
    ...row("providers", providerParts(context)),
    ...row("model choices", modelChoiceParts(context)),
  ]
  // Coverage is not something found, so it never turns an empty summary into a non-empty one.
  const coverage = context.categories === undefined ? [] : row("categories", coverageSummaryParts(context.categories))
  const sources = sourceNames(context)
  const lines = [sources.length > 0 ? `Found your ${sources.join(" and ")} setup` : "No OpenCode setup found"]
  if (rows.length > 0) lines.push(...rows)
  else lines.push("  nothing omo can import")
  lines.push(...coverage)
  const noted = notes(context)
  if (noted.length > 0) lines.push("Notes:", ...noted.map((notice) => `  ${notice}`))
  lines.push(MODEL_GUIDE_LINE)
  if (rows.length === 0) lines.push(...formatModelTemplate())
  return `${lines.join("\n")}\n`
}
