import type { PluginInput } from "@opencode-ai/plugin"
import type { ConsensusConfig } from "../../config/schema/consensus"
import { DEFAULT_VOTER_LINEAGES } from "../../config/schema/consensus"
import { getCallerLineageGroup, getDefaultVoterPool, getModelLineage, type VoterCandidate } from "../../shared/model-lineage"
import { fetchAvailableModels, getConnectedProviders } from "../../shared/model-availability"
import { log } from "../../shared"
import { VOTER_SPAWNER_DEFAULTS, spawnVoter } from "./voter-spawner"
import { resolveVoterCandidate } from "./voter-resolver"
import type { ConsensusInput, ConsensusResult, ResolvedVoterCandidate, VoterPosition } from "./types"

type RunConsensusDeps = {
  spawnVoter: typeof spawnVoter
  getConnectedProviders: typeof getConnectedProviders
  fetchAvailableModels: typeof fetchAvailableModels
}

const defaultDeps: RunConsensusDeps = { spawnVoter, getConnectedProviders, fetchAvailableModels }

export async function runConsensus(
  ctx: PluginInput,
  input: ConsensusInput,
  config: ConsensusConfig | undefined,
  deps: RunConsensusDeps = defaultDeps,
): Promise<ConsensusResult> {
  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const count = input.count ?? config?.default_voter_count ?? 3
  const voterTimeoutMs = input.voterTimeoutMs ?? config?.voter_timeout_ms ?? VOTER_SPAWNER_DEFAULTS.DEFAULT_VOTER_TIMEOUT_MS
  const reasoningEffort = config?.voter_reasoning_effort ?? VOTER_SPAWNER_DEFAULTS.DEFAULT_VOTER_REASONING_EFFORT

  const connectedProviders = new Set(await deps.getConnectedProviders(ctx.client))
  const availableModels = await deps.fetchAvailableModels(ctx.client, { connectedProviders: Array.from(connectedProviders) })

  const candidates = selectResolvedCandidates({
    requestedLineages: config?.default_voter_lineages,
    callerModel: input.callerModel,
    count,
    excludeLineages: input.excludeLineages,
    candidates: input.candidates,
    connectedProviders,
    availableModels,
  })

  if (candidates.length === 0) {
    log(`[consensus] no voters available; caller=${input.callerModel ?? "unknown"} connected=${Array.from(connectedProviders).join(",") || "none"}`)
    return buildEmptyResult(input, startedAt, startMs)
  }

  log(`[consensus] spawning ${candidates.length} voters; ${candidates.map(c => `${c.lineage}=${c.providerID}/${c.modelID}`).join(", ")}`)
  const voters: VoterPosition[] = await Promise.all(candidates.map(candidate =>
    deps.spawnVoter(ctx, {
      candidate,
      prompt: input.prompt,
      parentSessionID: input.parentSessionID,
      parentDirectory: input.parentDirectory,
      voterTimeoutMs,
      reasoningEffort,
    })
  ))

  const okVoters = voters.filter(isUsableVoterPosition).length
  const finishedAt = new Date().toISOString()
  return {
    triggerType: input.triggerType ?? "explicit",
    callerModel: input.callerModel,
    callerLineage: getModelLineage(input.callerModel),
    voters,
    advisoryOnly: okVoters < 2,
    startedAt,
    finishedAt,
    totalDurationMs: Date.now() - startMs,
  }
}

function isUsableVoterPosition(voter: VoterPosition): boolean {
  return voter.status === "ok" && voter.text.trim().length > 0
}

function selectResolvedCandidates(args: {
  requestedLineages: ReadonlyArray<string> | undefined
  callerModel: string | undefined
  count: number
  excludeLineages: ReadonlyArray<string> | undefined
  candidates: ReadonlyArray<VoterCandidate> | undefined
  connectedProviders: ReadonlySet<string>
  availableModels: Set<string>
}): ResolvedVoterCandidate[] {
  const explicit = args.candidates && args.candidates.length > 0
  const pool = explicit ? args.candidates! : filterPoolByRequestedLineages(args.requestedLineages)

  const excluded = new Set<string>(args.excludeLineages ?? [])
  if (!explicit) {
    for (const lineage of getCallerLineageGroup(args.callerModel)) excluded.add(lineage)
  }

  const seenLineage = new Set<string>()
  const resolved: ResolvedVoterCandidate[] = []
  for (const candidate of pool) {
    if (resolved.length >= args.count) break
    if (excluded.has(candidate.lineage)) continue
    if (seenLineage.has(candidate.lineage)) continue
    const resolvedCandidate = resolveVoterCandidate(candidate, args.connectedProviders, args.availableModels)
    if (!resolvedCandidate) continue
    seenLineage.add(candidate.lineage)
    resolved.push(resolvedCandidate)
  }
  return resolved
}

function filterPoolByRequestedLineages(requested: ReadonlyArray<string> | undefined): ReadonlyArray<VoterCandidate> {
  const pool = getDefaultVoterPool()
  const wanted = requested && requested.length > 0 ? requested : DEFAULT_VOTER_LINEAGES
  const wantedSet = new Set(wanted)
  const filtered = pool.filter(c => wantedSet.has(c.lineage))
  return filtered.length > 0 ? filtered : pool
}

function buildEmptyResult(input: ConsensusInput, startedAt: string, startMs: number): ConsensusResult {
  return {
    triggerType: input.triggerType ?? "explicit",
    callerModel: input.callerModel,
    callerLineage: getModelLineage(input.callerModel),
    voters: [],
    advisoryOnly: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startMs,
  }
}
