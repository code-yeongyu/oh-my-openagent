import { excludedModelPattern } from "@oh-my-opencode/omo-config-core"
import { log } from "@oh-my-opencode/utils"

import { RunnerError } from "../in-process/runner-error"
import type { RunnerFailureReason } from "../in-process/child-handle"
import { splitModelDecorators } from "../../senpi/explicit-pin"
import type { RpcRunnerSpec } from "../types"
import { type ModelCatalogProbeResult, parseModelCatalog, probeModelCatalog } from "./model-catalog-probe"
import { buildRpcModelCatalogSpawn, type RpcSpawnDescriptor } from "./spawn"

export { parseModelCatalog, probeModelCatalog, PROBE_TIMEOUT_MS } from "./model-catalog-probe"
export type {
  ModelCatalogProbeOptions,
  ModelCatalogProbeResult,
  ModelCatalogSpawnOptions,
} from "./model-catalog-probe"

/**
 * A successful catalog is cached only briefly: `senpi auth login` or an edit to the child-visible
 * settings changes which models resolve, and nothing in this process observes that. A short TTL
 * bounds how long a stale success can reject an otherwise valid model.
 */
export const MODEL_CATALOG_CACHE_TTL_MS = 120_000

/**
 * The oldest successful catalog still consulted when a fresh probe is inconclusive (#10863). It is
 * only ever used to ADMIT: a model listed within the last half hour is far likelier to still be
 * served than not, while absence from it proves nothing, and the child's own model resolution stays
 * the authority either way. Thirty minutes spans a sustained load spike (the probes time out for
 * minutes, not seconds) yet stays well short of the hours over which logins and settings drift.
 */
export const MODEL_CATALOG_MAX_STALE_MS = 30 * 60_000

export type RpcModelAdmissionVerdict =
  | {
      readonly verdict: "inconclusive"
      readonly model: string
      readonly profileKey: string
      readonly elapsedMs: number
    }
  | {
      readonly verdict: "stale_catalog"
      readonly model: string
      readonly profileKey: string
      readonly elapsedMs: number
      readonly catalogAgeMs: number
    }

export type RpcModelAdmission = (spec: RpcRunnerSpec) => Promise<void>

export type RpcModelAdmissionOptions = {
  // omo.json exclude_models: a spawn or revival on an excluded model fails before any probe.
  readonly excludeModels?: readonly string[]
  readonly buildSpawn?: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  readonly probe?: (descriptor: RpcSpawnDescriptor) => Promise<ModelCatalogProbeResult>
  readonly now?: () => number
  /** Told every time a start is admitted without a fresh verdict, so a real outage stays visible. */
  readonly onInconclusive?: (verdict: RpcModelAdmissionVerdict) => void
}

type ProbedCatalog = {
  readonly models: ReadonlySet<string>
  readonly stderrTail: string
}

type ProbeOutcome =
  | { readonly kind: "catalog"; readonly catalog: ProbedCatalog }
  | { readonly kind: "inconclusive" }

type CachedCatalog = {
  readonly catalog: Promise<ProbeOutcome>
  readonly cachedAt: number
}

type GoodCatalog = {
  readonly catalog: ProbedCatalog
  readonly probedAt: number
}

function profileKey(descriptor: RpcSpawnDescriptor): string {
  return JSON.stringify([
    descriptor.command,
    descriptor.args,
    descriptor.cwd,
    descriptor.env.OMO_CODING_AGENT_DIR,
    descriptor.env.SENPI_CODING_AGENT_DIR,
    descriptor.env.PI_CODING_AGENT_DIR,
    descriptor.env.HOME,
    descriptor.env.USERPROFILE,
    descriptor.env.XDG_CONFIG_HOME,
  ])
}

function admissionFailure(
  model: string,
  reason: RunnerFailureReason,
  message: string,
  cause?: unknown,
): RunnerError {
  return new RunnerError({
    kind: "model_unavailable",
    reason,
    message: `process model admission failed for ${model}: ${message}`,
    ...(cause === undefined ? {} : { cause }),
  })
}

function readCatalog(model: string, result: ModelCatalogProbeResult): ProbedCatalog {
  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(-2_000)
    throw admissionFailure(
      model,
      "catalog_probe_failed",
      `catalog probe exited ${result.code}${detail.length === 0 ? "" : `: ${detail}`}`,
    )
  }
  return { models: parseModelCatalog(result.stdout), stderrTail: result.stderr.trim().slice(-1_000) }
}

function absenceFailure(model: string, confirmed: ProbedCatalog): RunnerError {
  return admissionFailure(
    model,
    "model_not_in_child_profile",
    `model is not visible in the child profile after a confirming re-probe (probed catalog has ${confirmed.models.size} models${
      confirmed.stderrTail.length === 0 ? "" : `; child stderr: ${confirmed.stderrTail}`
    }); forward its provider extension or child-visible settings`,
  )
}

// A `provider/model:level` pin is valid: senpi's `--model` parses the suffix as a thinking level, so
// admission checks the catalog against the base id, never the decorated one (#9722).
function lists(catalog: ProbedCatalog, model: string): boolean {
  if (catalog.models.has(model)) return true
  const { base } = splitModelDecorators(model)
  return base !== model && catalog.models.has(base)
}

function logInconclusive(verdict: RpcModelAdmissionVerdict): void {
  log("senpi-task model admission inconclusive; admitting the start", verdict)
}

/**
 * `--list-models` exits 0 with whatever providers resolved inside its OWN budget, so an exit-0
 * catalog is a lower bound on what the child can reach, never proof of absence: repeated identical
 * probes on one machine returned 1359, 541, 1071 and 1067 catalog lines, all exit 0. A missing model
 * is therefore an UNCONFIRMED verdict. It is settled by one fresh probe that bypasses the cache, and
 * the catalog that lacked the model is dropped so it can never reject that model again from cache.
 *
 * A probe that times out reaches no verdict at all, and admission never blocks a start it cannot
 * judge (#10863): it admits, reports the inconclusive verdict, and leaves the child's own model
 * resolution as the authority - a child that truly cannot serve the model still fails typed
 * `model_unavailable` at its start.
 */
export function createRpcModelAdmission(options: RpcModelAdmissionOptions = {}): RpcModelAdmission {
  const buildSpawn = options.buildSpawn ?? buildRpcModelCatalogSpawn
  const probe = options.probe ?? probeModelCatalog
  const now = options.now ?? Date.now
  const onInconclusive = options.onInconclusive ?? logInconclusive
  const catalogs = new Map<string, CachedCatalog>()
  const lastGood = new Map<string, GoodCatalog>()
  const probeCatalog = async (descriptor: RpcSpawnDescriptor, model: string, key: string): Promise<ProbeOutcome> => {
    const first = await probe(descriptor)
    // A timed-out probe is INCONCLUSIVE, never evidence of absence: the child was killed before it
    // finished listing, so it says nothing about whether the model is visible. Re-probe once with a
    // fresh spawn; if that one times out too, the outcome stays inconclusive and the caller admits.
    // Widening the timeout was tried twice and is the wrong lever - the true completion time is
    // unknown because the probe never got to finish, and it grows with host load (#10863).
    // Every other outcome is answered by the first probe and is deliberately NOT retried: a
    // non-zero exit is a real failure, and a complete exit-0 listing is handled by the existing
    // confirming re-probe path.
    const result = first.timedOut ? await probe(descriptor) : first
    if (result.timedOut) return { kind: "inconclusive" }
    const catalog = readCatalog(model, result)
    lastGood.set(key, { catalog, probedAt: now() })
    return { kind: "catalog", catalog }
  }
  const evict = (key: string, catalog: Promise<ProbeOutcome>): void => {
    if (catalogs.get(key)?.catalog === catalog) catalogs.delete(key)
  }
  // No fresh verdict: judge against the last successful catalog when it is recent enough, and only
  // to admit. Absence from an old (or this start's own unconfirmed) listing is not proof either.
  const admitUnjudged = (model: string, key: string, startedAt: number): void => {
    const at = now()
    const elapsedMs = at - startedAt
    const good = lastGood.get(key)
    if (good !== undefined && at - good.probedAt <= MODEL_CATALOG_MAX_STALE_MS && lists(good.catalog, model)) {
      onInconclusive({ verdict: "stale_catalog", model, profileKey: key, elapsedMs, catalogAgeMs: at - good.probedAt })
      return
    }
    onInconclusive({ verdict: "inconclusive", model, profileKey: key, elapsedMs })
  }

  return async (spec) => {
    const model = spec.model?.trim()
    if (model === undefined || model.length === 0) return
    const excludedBy = excludedModelPattern(splitModelDecorators(model).base, options.excludeModels)
    if (excludedBy !== undefined) {
      throw new RunnerError({
        kind: "model_unavailable",
        message: `process model admission refused ${model}: exclude_models in omo.json keeps it out ("${excludedBy}")`,
      })
    }
    const startedAt = now()
    const descriptor = buildSpawn(spec)
    const key = profileKey(descriptor)
    const cached = catalogs.get(key)
    // Concurrent starts for one profile share the in-flight probe: it is cached before it settles.
    let catalog = cached !== undefined && now() - cached.cachedAt < MODEL_CATALOG_CACHE_TTL_MS ? cached.catalog : undefined
    if (catalog === undefined) {
      catalog = probeCatalog(descriptor, model, key)
      catalogs.set(key, { catalog, cachedAt: now() })
    }
    let observed: ProbeOutcome
    try {
      observed = await catalog
    } catch (error) {
      evict(key, catalog)
      throw error
    }
    if (observed.kind === "inconclusive") {
      // Never cached: the next start probes again, so a recovered host gets a real verdict at once.
      evict(key, catalog)
      admitUnjudged(model, key, startedAt)
      return
    }
    if (lists(observed.catalog, model)) return
    evict(key, catalog)
    const confirming = probeCatalog(descriptor, model, key)
    const confirmed = await confirming
    if (confirmed.kind === "inconclusive") {
      admitUnjudged(model, key, startedAt)
      return
    }
    if (lists(confirmed.catalog, model)) {
      catalogs.set(key, { catalog: confirming, cachedAt: now() })
      return
    }
    throw absenceFailure(model, confirmed.catalog)
  }
}
