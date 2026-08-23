import { RunnerError } from "../in-process/runner-error"
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

export type RpcModelAdmission = (spec: RpcRunnerSpec) => Promise<void>

export type RpcModelAdmissionOptions = {
  readonly buildSpawn?: (spec: RpcRunnerSpec) => RpcSpawnDescriptor
  readonly probe?: (descriptor: RpcSpawnDescriptor) => Promise<ModelCatalogProbeResult>
  readonly now?: () => number
}

type ProbedCatalog = {
  readonly models: ReadonlySet<string>
  readonly stderrTail: string
}

type CachedCatalog = {
  readonly catalog: Promise<ProbedCatalog>
  readonly cachedAt: number
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

function admissionFailure(model: string, message: string, cause?: unknown): RunnerError {
  return new RunnerError({
    kind: "model_unavailable",
    message: `process model admission failed for ${model}: ${message}`,
    ...(cause === undefined ? {} : { cause }),
  })
}

function readCatalog(model: string, result: ModelCatalogProbeResult): ProbedCatalog {
  if (result.timedOut) throw admissionFailure(model, "catalog probe timed out")
  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(-2_000)
    throw admissionFailure(model, `catalog probe exited ${result.code}${detail.length === 0 ? "" : `: ${detail}`}`)
  }
  return { models: parseModelCatalog(result.stdout), stderrTail: result.stderr.trim().slice(-1_000) }
}

function absenceFailure(model: string, confirmed: ProbedCatalog): RunnerError {
  return admissionFailure(
    model,
    `model is not visible in the child profile after a confirming re-probe (probed catalog has ${confirmed.models.size} models${
      confirmed.stderrTail.length === 0 ? "" : `; child stderr: ${confirmed.stderrTail}`
    }); forward its provider extension or child-visible settings`,
  )
}

/**
 * `--list-models` exits 0 with whatever providers resolved inside its OWN budget, so an exit-0
 * catalog is a lower bound on what the child can reach, never proof of absence: repeated identical
 * probes on one machine returned 1359, 541, 1071 and 1067 catalog lines, all exit 0. A missing model
 * is therefore an UNCONFIRMED verdict. It is settled by one fresh probe that bypasses the cache, and
 * the catalog that lacked the model is dropped so it can never reject that model again from cache.
 */
export function createRpcModelAdmission(options: RpcModelAdmissionOptions = {}): RpcModelAdmission {
  const buildSpawn = options.buildSpawn ?? buildRpcModelCatalogSpawn
  const probe = options.probe ?? probeModelCatalog
  const now = options.now ?? Date.now
  const catalogs = new Map<string, CachedCatalog>()
  const probeCatalog = async (descriptor: RpcSpawnDescriptor, model: string): Promise<ProbedCatalog> => {
    const first = await probe(descriptor)
    // A timed-out probe is INCONCLUSIVE, never evidence of absence: the child was killed before it
    // finished listing, so it says nothing about whether the model is visible. Treating that as
    // `model_unavailable` is what made a slow cold start on a loaded runner look like a missing
    // model. Re-probe once with a fresh spawn instead. Widening the timeout was tried twice and is
    // the wrong lever - the true completion time is unknown because the probe never got to finish.
    // Every other outcome is answered by the first probe and is deliberately NOT retried: a
    // non-zero exit is a real failure, and a complete exit-0 listing is handled by the existing
    // confirming re-probe path.
    const result = first.timedOut ? await probe(descriptor) : first
    return readCatalog(model, result)
  }
  const evict = (key: string, catalog: Promise<ProbedCatalog>): void => {
    if (catalogs.get(key)?.catalog === catalog) catalogs.delete(key)
  }

  return async (spec) => {
    const model = spec.model?.trim()
    if (model === undefined || model.length === 0) return
    const descriptor = buildSpawn(spec)
    const key = profileKey(descriptor)
    const cached = catalogs.get(key)
    let catalog = cached !== undefined && now() - cached.cachedAt < MODEL_CATALOG_CACHE_TTL_MS ? cached.catalog : undefined
    if (catalog === undefined) {
      catalog = probeCatalog(descriptor, model)
      catalogs.set(key, { catalog, cachedAt: now() })
    }
    let observed: ProbedCatalog
    try {
      observed = await catalog
    } catch (error) {
      evict(key, catalog)
      throw error
    }
    if (observed.models.has(model)) return
    evict(key, catalog)
    const confirming = probeCatalog(descriptor, model)
    const confirmed = await confirming
    if (!confirmed.models.has(model)) throw absenceFailure(model, confirmed)
    catalogs.set(key, { catalog: confirming, cachedAt: now() })
  }
}
