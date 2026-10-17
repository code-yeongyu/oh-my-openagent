/**
 * The model-choice stage of `omo setup`: what `setup-opencode-models.js` converted, classified
 * against the files the engine and the native harness read. `planModelChoices` only reads;
 * `applyModelChoices` is the one writer.
 *
 * - `<agentDir>/settings.json[c]` `defaultProvider` + `defaultModel`: the engine's saved default
 *   (settings-manager.js `getDefaultProvider` / `getDefaultModel`, handed to model-resolver.js
 *   `findInitialModel` by sdk.js). An interactive session starts on it, and the engine's
 *   recommended-models builtin never replaces a model of `settings` provenance.
 * - `~/.omo/omo.json[c]` `[native].model_profile`: headless and desktop sessions apply the model
 *   profile over that saved default, Recommended when unset (omo-senpi model-profile component);
 *   a `provider/model` value is a pin, so it carries the same default there.
 * - `[native].categories.<name>` / `[native].agents.<name>`: the native harness view
 *   (omo-config-core loader/resolution.ts folds `[native]` over the shared base keys).
 *
 * A key either file already has, in the harness block or the shared base, is never overwritten.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { timestamp } from "./auth-store.js"
import { loadEngineModels } from "./engine-models.js"
import { insertJsoncMember } from "./jsonc-edit.js"
import { parseJsonc } from "./jsonc.js"
import { convertModelChoices, hasModelChoices, readModelChoices } from "./setup-opencode-models.js"

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readTarget(path) {
  if (!existsSync(path)) return { path, document: {}, text: undefined }
  const text = readFileSync(path, "utf8")
  try {
    const document = parseJsonc(text)
    if (!isPlainObject(document)) throw new Error("expected an object")
    return { path, document, text }
  } catch {
    return { path, document: {}, text, malformed: true }
  }
}

// The file omo-config-core's loader reads as the user layer (loader/paths.ts): omo.jsonc, else
// omo.json; a new file is omo.jsonc.
function omoTargetPath(home) {
  const jsonc = join(home, ".omo", "omo.jsonc")
  const json = join(home, ".omo", "omo.json")
  return existsSync(jsonc) || !existsSync(json) ? jsonc : json
}

// settings-manager.js `resolveSettingsSource`: settings.jsonc wins over settings.json.
function settingsTargetPath(agentDir) {
  const jsonc = join(agentDir, "settings.jsonc")
  return existsSync(jsonc) ? jsonc : join(agentDir, "settings.json")
}

// The loader reads a `[senpi]` block as `[native]` when no `[native]` exists (legacy-harness-names.ts),
// so a config still spelled `[senpi]` is written there rather than shadowed by a new block.
function harnessBlock(document) {
  if (document["[native]"] === undefined && document["[senpi]"] !== undefined) return "[senpi]"
  return "[native]"
}

function lookup(document, path) {
  return path.reduce((node, key) => (isPlainObject(node) && Object.hasOwn(node, key) ? node[key] : undefined), document)
}

function planItems(plan, omo, settings) {
  const block = harnessBlock(omo.document)
  const items = []
  if (plan.defaultModel !== undefined) {
    const { provider, modelId, ref } = plan.defaultModel
    items.push({ label: "default model", kind: "default", target: settings, path: [], members: [["defaultProvider", provider], ["defaultModel", modelId]] })
    items.push({ label: "model_profile", kind: "default", target: omo, path: [block], members: [["model_profile", ref]] })
  }
  for (const [kind, key] of [["categories", "category"], ["agents", "agent"]]) {
    for (const { name, entry } of plan[kind]) {
      items.push({ label: `${key} ${name}`, kind, name, target: omo, path: [block, kind], members: [[name, entry]] })
    }
  }
  return items
}

// `pending` writes, `kept` differs from what the file already has, `carried` is already there.
function classify(item) {
  if (item.target.malformed) return "blocked"
  const container = lookup(item.target.document, item.path)
  if (container !== undefined && !isPlainObject(container)) return "blocked"
  const existing = item.members.map(([key]) => lookup(item.target.document, [...item.path, key])
    ?? (item.path[0]?.startsWith("[") ? lookup(item.target.document, [...item.path.slice(1), key]) : undefined))
  if (existing.every((value) => value === undefined)) return "pending"
  return item.members.every(([, value], index) => isDeepStrictEqual(existing[index], value)) ? "carried" : "kept"
}

function list(label, values) {
  return `${label}: ${values.length > 0 ? values.join(", ") : "none"}`
}

function labels(plan, state) {
  return plan.items.filter((item) => item.state === state).map((item) => item.label)
}

// Every reason a choice was not written, as notices: a blocked target, then each dropped choice.
function planNotices(items, dropped) {
  const lines = []
  for (const target of new Set(items.filter((item) => item.state === "blocked").map((item) => item.target.path))) {
    lines.push(`WARN senpi: ${target} is malformed or has a non-object block; these model choices were not written: ${items.filter((item) => item.state === "blocked" && item.target.path === target).map((item) => item.label).join(", ")}`)
  }
  for (const reason of dropped) lines.push(`model choice not carried: ${reason}`)
  return lines
}

export function modelChoicePlanLines(plan) {
  return [
    list("planned-model-choices", labels(plan, "pending")),
    list("model-choices-skipped-existing", labels(plan, "kept")),
    list("model-choices-already-carried", labels(plan, "carried")),
    `model-choices-not-carried: ${plan.dropped.length}`,
  ]
}

export function modelChoiceCounts(plan) {
  return [
    list("model-choices-carried", plan.carried ?? []),
    list("model-choices-skipped-existing", labels(plan, "kept")),
    `model-choices-not-carried: ${plan.dropped.length}`,
  ]
}

export function modelChoiceQuestion(plan) {
  const targets = [...new Set(plan.items.filter((item) => item.state === "pending").map((item) => item.target.path))]
  return `Write ${plan.pending} model choice(s) into ${targets.join(" and ")}? [y/N] `
}

function writeText(target, text) {
  mkdirSync(dirname(target.path), { recursive: true })
  if (target.text !== undefined) copyFileSync(target.path, `${target.path}.bak-${timestamp()}`)
  // A config symlinked from a dotfiles checkout is written through the link, not replaced by a copy.
  const destination = target.text !== undefined ? realpathSync(target.path) : target.path
  const temporary = `${destination}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 })
    // The edited file keeps its own permissions: a 0600 config must not come back world-readable.
    if (target.text !== undefined) chmodSync(temporary, statSync(destination).mode & 0o7777)
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

// Every edit is an insertion into the file's own text (comments, order and formatting survive);
// a file the edit cannot reproduce exactly is left untouched and reported.
function writeTarget(target, items) {
  try {
    let text = target.text ?? "{}\n"
    for (const item of items) {
      for (const [key, value] of item.members) text = insertJsoncMember(text, item.path, key, value)
    }
    writeText(target, text)
    return items.map((item) => item.label)
  } catch (error) {
    process.stdout.write(`WARN senpi: could not edit ${target.path} safely (${error.message}); these model choices were not written: ${items.map((item) => item.label).join(", ")}\n`)
    return []
  }
}

/**
 * Read-only. `customProviders` are the providers the custom-provider stage adds in this run: the
 * plan is built before anything is written, so they are validated as if models.json had them.
 */
export async function planModelChoices(stage) {
  const { home, env } = stage.runtime
  const omo = readTarget(omoTargetPath(home))
  const raw = readModelChoices({ home, env, opencodeBlock: omo.document["[opencode]"] })
  const empty = { notices: raw.notices, present: false, items: [], dropped: [], pending: 0 }
  if (!hasModelChoices(raw)) return empty
  let registry
  try {
    registry = await (stage.loadRegistry ?? loadEngineModels)({ agentDir: stage.agentDir, customProviders: stage.customProviders })
  } catch (error) {
    return { ...empty, notices: [...raw.notices, `WARN senpi: could not read the engine's model list (${error.message}); model choices were not carried`] }
  }
  const converted = convertModelChoices(raw, registry, stage.oauthProviders)
  const settings = readTarget(settingsTargetPath(stage.agentDir))
  const items = planItems(converted, omo, settings).map((item) => ({ ...item, state: classify(item) }))
  return {
    notices: [...raw.notices, ...planNotices(items, converted.dropped)],
    present: true,
    items,
    dropped: converted.dropped,
    defaultModel: converted.defaultModel,
    pending: items.filter((item) => item.state === "pending").length,
  }
}

/** The stage's one writer; records what it wrote as `plan.carried` for the counts. */
export function applyModelChoices(plan) {
  const pending = plan.items.filter((item) => item.state === "pending")
  const targets = [...new Set(pending.map((item) => item.target))]
  plan.carried = targets.flatMap((target) => writeTarget(target, pending.filter((item) => item.target === target)))
}
