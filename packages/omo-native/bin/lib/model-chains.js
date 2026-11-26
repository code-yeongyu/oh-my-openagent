// @ts-check
/**
 * `omo doctor --models [--json]`: per category and task agent, the model a spawn runs first, the
 * runtime retry chain in order, and every declared rung with its source (built-in, omo.json, the
 * category an agent borrows) and whether it runs, then the main session's model_profile lane.
 *
 * The answer comes from the same places `omo doctor`'s coverage line does: the pinned engine's
 * offline model list (`engineAvailableModels`: auth.json, models.json, env keys; no network, nothing
 * written) classified by the spawn resolvers through the staged category-coverage runtime bundle.
 * Unlike the coverage line this is an explicit request, so a runtime that cannot answer fails it.
 */

import { canonicalAgentDir } from "./agent-dir.js"
import { COVERAGE_RUNTIME, engineAvailableModels } from "./category-coverage.js"
import { packageRoot } from "./package-paths.js"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * @typedef {{
 *   model: string,
 *   providers?: string[],
 *   source: string,
 *   state: "primary" | "excluded" | "no-login" | "not-reached" | "applied" | "fallback",
 *   excludedBy?: string,
 * }} Rung
 * @typedef {{ name: string, status: string, runtime: string[], reason?: string, rungs: Rung[] }} ChainEntry
 */

/** @type {Record<Exclude<Rung["state"], "fallback">, (rung: Rung) => string>} */
const STATE_TEXT = {
  primary: () => "runs first",
  excluded: (rung) => `excluded by exclude_models "${rung.excludedBy}"`,
  "no-login": () => "no login",
  "not-reached": () => "not reached",
  applied: () => "applied",
}

/** @param {Rung} rung */
function rungModel(rung) {
  return rung.providers === undefined ? rung.model : `${rung.model} (${rung.providers.join(" | ")})`
}

/** @param {Rung[]} rungs */
function rungLines(rungs) {
  let fallback = 0
  const width = Math.max(0, ...rungs.map((rung) => rungModel(rung).length))
  return rungs.map((rung, index) => {
    const state = rung.state === "fallback" ? `fallback ${(fallback += 1)}` : STATE_TEXT[rung.state](rung)
    return `    ${index + 1}. ${rungModel(rung).padEnd(width)}  ${rung.source.padEnd(9)}  ${state}`
  })
}

/** @param {ChainEntry} entry */
function entryLines(entry) {
  const head =
    entry.status === "resolved"
      ? `  ${entry.name}: ${entry.runtime.join(" -> ")}`
      : `  ${entry.name}: ${entry.status}${entry.reason === undefined ? "" : ` (${entry.reason})`}`
  return [head, ...rungLines(entry.rungs)]
}

/** The human report. @param {any} view the runtime's `modelChains` result */
export function formatModelChainLines(view) {
  const profile = view.modelProfile
  const lane =
    profile.selection === "set"
      ? `model_profile ${profile.profile}`
      : `model_profile unset, default lane ${profile.profile}`
  return [
    "Models a spawn resolves right now (logins read offline; credentials are not probed).",
    `exclude_models: ${view.excludeModels.length === 0 ? "none" : view.excludeModels.join(", ")}`,
    ...(view.configProfile === undefined ? [] : [`config profile: ${view.configProfile}`]),
    "",
    "categories",
    ...view.categories.flatMap(entryLines),
    "",
    "agents",
    ...view.agents.flatMap(entryLines),
    "",
    `main session (${lane})`,
    `  ${profile.applied ?? `none${profile.reason === undefined ? "" : ` (${profile.reason})`}`}`,
    ...rungLines(profile.rungs),
  ]
}

async function loadRuntime() {
  return import(pathToFileURL(join(packageRoot, COVERAGE_RUNTIME)).href)
}

/**
 * `diagnostics.models`: the view the runtime's resolvers answer. A runtime or engine that cannot answer is
 * `internal_error` with the reason it gave in `details.reason`: free text that can embed what the runtime read (a path,
 * a config value), so the call is refused to a session.
 * @type {import("./diagnostics-contract").DiagnosticsCalls["models"]}
 */
export async function models(_input = {}, ports = {}) {
  try {
    const runtime = await (ports.loadRuntime ?? loadRuntime)()
    const cwd = ports.cwd ?? process.cwd()
    const env = ports.env ?? process.env
    const available = await engineAvailableModels({
      agentDir: ports.agentDir ?? canonicalAgentDir(env),
      cwd,
      loadEngine: ports.loadEngine,
    })
    return { kind: "ok", value: runtime.modelChains({ models: available, cwd, env }) }
  } catch (error) {
    return {
      kind: "error",
      error: {
        code: "internal_error",
        message: "the model chains could not be resolved",
        next_action: "run omo doctor to check the installation, then retry",
        details: { reason: error instanceof Error ? error.message : String(error) },
      },
    }
  }
}

/**
 * @param {import("./diagnostics-contract").ModelsPorts & { json: boolean }} options
 * @returns {Promise<{ output: string, failed: boolean }>}
 */
export async function doctorModelChains(options) {
  const result = await models({}, options)
  if (result.kind === "error") return { output: `FAIL models: ${result.error.details?.reason}`, failed: true }
  try {
    return {
      output: options.json ? JSON.stringify(result.value, null, 2) : formatModelChainLines(result.value).join("\n"),
      failed: false,
    }
  } catch (error) {
    return { output: `FAIL models: ${error instanceof Error ? error.message : String(error)}`, failed: true }
  }
}

/**
 * Prints the report and returns the exit code: 0, 1 when the runtime cannot answer, 2 for an option
 * other than `--json`.
 * @param {string[]} args the arguments after `--models`
 * @param {import("./diagnostics-contract").ModelsPorts} options
 * @returns {Promise<number>}
 */
export async function runDoctorModels(args, options) {
  const unknown = args.filter((arg) => arg !== "--json")
  if (unknown.length > 0) {
    console.error(`omo doctor --models: unknown option ${unknown.join(" ")} (accepted: --json)`)
    return 2
  }
  const result = await doctorModelChains({ ...options, json: args.includes("--json") })
  console.log(result.output)
  return result.failed ? 1 : 0
}
