// @ts-check
// The setup calls of the omo SDK's install namespace (slice C1c, #14960): detect, plan and apply, each resolving to
// { kind: "ok", value } or a typed failure. Nothing here prints, exits or reads a terminal; `omo setup` renders them.

import { homedir } from "node:os"
import { dirname, relative } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { setupCoverage } from "./category-coverage.js"
import {
  applySetupStages,
  collectSetupPlans,
  scanSetup,
  setupApplyFault,
  setupEntryText,
  setupStages,
} from "./setup-stream.js"
import { displayPath, setupSummary } from "./setup-summary.js"
import { failure } from "./install-result.js"

/**
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/failure.ts").OmoFailure} Failure
 */
/**
 * @template T
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/failure.ts").OmoValue<T>} Result
 */

/**
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/results/host.ts").SetupStageId} SetupStageId
 * @typedef {import("./setup-stream.js").SetupPlanEntry & { readonly text: string }} InstallSetupPlanEntry
 * @typedef {import("./setup-stream.js").SetupCountEntry & { readonly text: string }} InstallSetupCountEntry
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/results/host.ts").SetupInventory} InstallSetupInventory
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/results/host.ts").SetupPlan} InstallSetupPlan
 * @typedef {import("../../../omo-senpi/src/components/omo-sdk/contract/results/host.ts").SetupApplied} InstallSetupApplied
 * @typedef {{ home?: string, env?: NodeJS.ProcessEnv, loadCoverageRuntime?: () => Promise<any>,
 *   loadCoverageEngine?: () => Promise<any>, loadModelCatalog?: () => Promise<any>, pluginRoot?: string,
 *   onProgress?: (event: { kind: "notice", text: string }) => void,
 *   fs?: typeof import("./setup-fs.js").REAL_SETUP_FS }} SetupPorts
 */

const FIX_INPUT = "Fix the named input and call it again."

/** @param {SetupPorts} ports */
function setupRuntime(ports) {
  const home = ports.home ?? homedir()
  const env = ports.env ?? process.env
  return { ...ports, home, env, agentDir: canonicalAgentDir(env, home) }
}

// The value a setup call threw, kept beside the typed failure it answered (never a field of it), so the command can end
// with the very error it ended with before these calls existed.
const THROWN = new WeakMap()

/**
 * What a setup call threw for the failure it answered, when that failure stands for one; undefined otherwise.
 * @param {Failure} answer @returns {unknown}
 */
export function thrownBy(answer) {
  return THROWN.get(answer)
}

/** @param {unknown} error */
function setupFailure(error) {
  const fault = setupApplyFault(error)
  const answer = failure(
    "internal_error",
    "omo setup could not finish",
    "Read details.cause, fix it, then call it again.",
    {
      cause: error instanceof Error ? error.message : String(error),
      // A partial apply: the stages written before the fault stay; none after it ran.
      ...(fault === undefined ? {} : { applied_stages: fault.applied, failed_stage: fault.stage }),
    },
  )
  THROWN.set(answer, error)
  return answer
}

/**
 * @template {import("./setup-stream.js").SetupEntry} Entry
 * @param {Entry} entry @returns {Entry & { readonly text: string }}
 */
const withText = (entry) => ({ ...entry, text: setupEntryText(entry) })

/**
 * The directories the whole plan writes into, a directory inside another one folded into it.
 * @param {any} plans @param {string} agentDir @param {string} home @returns {string[]}
 */
function targetRoots(plans, agentDir, home) {
  const choiceDirs = plans.modelChoices.items
    .filter((/** @type {any} */ item) => item.state === "pending")
    .map((/** @type {any} */ item) => dirname(item.target.path))
  const roots = [...new Set([agentDir, ...choiceDirs])]
  const inside = (/** @type {string} */ path, /** @type {string} */ root) =>
    path !== root && !relative(root, path).startsWith("..")
  return roots.filter((path) => !roots.some((root) => inside(path, root))).map((path) => displayPath(path, home))
}

/**
 * One owner's setup calls: a plan its plan call answered can be applied only through its own apply. The SDK root makes
 * one per root (sdk-install.js), so a plan never crosses roots; the command makes one per run.
 */
export function createSetup() {
  // The plans each answered SetupPlan stands for; they hold target file bytes, so they never leave this closure.
  const held = new WeakMap()
  return {
    /**
     * install.setup.detect(): the harnesses found on this machine and what each holds, read only.
     * @param {object} [_input] @param {SetupPorts} [ports]
     * @returns {Promise<Result<InstallSetupInventory>>}
     */
    async detect(_input = {}, ports = {}) {
      const runtime = setupRuntime(ports)
      try {
        for await (const result of scanSetup(runtime, runtime.agentDir, { includeCustomProviders: true })) {
          if (result.source !== "detect") continue
          if (result.error !== undefined) throw result.error
          return { kind: "ok", value: /** @type {InstallSetupInventory} */ (/** @type {unknown} */ (result.plan)) }
        }
        return { kind: "ok", value: { harnesses: [] } }
      } catch (error) {
        return setupFailure(error)
      }
    },

    /**
     * install.setup.plan(): what `omo setup --dry-run` prints, as data. Nothing is written.
     * @param {object} [_input] @param {SetupPorts} [ports]
     * @returns {Promise<Result<InstallSetupPlan>>}
     */
    async plan(_input = {}, ports = {}) {
      try {
        const runtime = setupRuntime(ports)
        const { home, env, agentDir } = runtime
        // The CLI has always carried OpenCode's custom providers; the onboarding RPC leaves them opt-in.
        const { inventory, plans } = await collectSetupPlans(
          scanSetup(runtime, agentDir, { includeCustomProviders: true }),
        )
        const categories = await setupCoverage({
          agentDir,
          home,
          env,
          plans,
          loadRuntime: ports.loadCoverageRuntime,
          loadEngine: ports.loadCoverageEngine,
        })
        const stages = setupStages(plans).map((stage) => {
          const pending = stage.plan?.pending ?? 0
          return {
            id: stage.id,
            description: pending > 0 ? stage.question(stage.plan) : "",
            present: stage.present,
            pending,
            entries: stage.present ? stage.entries(stage.plan).map(withText) : [],
          }
        })
        /** @type {InstallSetupPlan} */
        const value = {
          inventory: /** @type {InstallSetupInventory} */ (/** @type {unknown} */ (inventory)),
          stages,
          summary: setupSummary({ home, agentDir, inventory, ...plans, categories }),
          pending: stages.reduce((total, stage) => total + stage.pending, 0),
          target_roots: targetRoots(plans, agentDir, home),
        }
        held.set(value, plans)
        return { kind: "ok", value }
      } catch (error) {
        return setupFailure(error)
      }
    },

    /**
     * install.setup.apply({ plan, consent, decide? }): writes what the plan holds. consent "all" applies every pending
     * stage; "each" calls decide once per pending stage, in plan order, before that stage's write.
     * @param {import("../../../omo-senpi/src/components/omo-sdk/contract/root.ts").RootCallInput<"install.setup.apply">} input
     * @param {SetupPorts} [ports]
     * @returns {Promise<Result<InstallSetupApplied>>}
     */
    async apply(input, ports = {}) {
      const { plan, consent, decide } = input
      if (consent !== "all" && consent !== "each")
        return failure("invalid_arguments", "consent is all or each", FIX_INPUT, { field: "consent" })
      if (consent === "each" && typeof decide !== "function")
        return failure("invalid_arguments", "consent each needs decide", FIX_INPUT, { field: "decide" })
      const plans = held.get(plan)
      if (plans === undefined)
        return failure("invalid_arguments", "plan is not one install.setup.plan answered here", FIX_INPUT, {
          field: "plan",
        })
      const progress = ports.onProgress ?? (() => {})
      let applied
      try {
        applied = await applySetupStages(
          plans,
          consent === "all"
            ? () => true
            : async (stage) =>
                (await /** @type {NonNullable<typeof decide>} */ (decide)({
                  id: stage.id,
                  description: stage.question(stage.plan),
                })) === "apply",
          (text) => progress({ kind: "notice", text }),
          ports.fs === undefined ? {} : { fs: ports.fs },
        )
      } catch (error) {
        return setupFailure(error)
      }
      const stages = setupStages(plans)
      return {
        kind: "ok",
        value: {
          applied: [...applied],
          skipped: stages
            .filter((stage) => (stage.plan?.pending ?? 0) > 0 && !applied.has(stage.id))
            .map((stage) => stage.id),
          stages: stages
            .filter((stage) => stage.present)
            .map((stage) => {
              const reported = applied.has(stage.id) || stage.plan.pending === 0
              return {
                id: stage.id,
                outcome: applied.has(stage.id) ? "applied" : stage.plan.pending === 0 ? "nothing_pending" : "skipped",
                entries: reported ? stage.countEntries(stage.plan).map(withText) : [],
              }
            }),
        },
      }
    },
  }
}

/** The setup calls \`omo setup\` runs on. */
export const setup = createSetup()
