// allow: SIZE_OK - the run lifecycle surface keeps key idempotency, session ownership, and snapshot projection on one contract so callers cannot bypass a step.
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import { join } from "node:path"

import { defaultSignaller } from "../lifecycle/context"
import { dagDefinitionAmendedEvent, dagRunCreatedEvent, type DagRunEventType } from "./events"
import { dagDefinitionFingerprint, diffNodeFingerprints, type DagNodeFingerprintInputV1 } from "./fingerprint"
import { compileDag, type DagCompileError, type DagDefinition, type DagNodeInput } from "./graph"
import { createDagJournal, type DagJournalCheckpoint } from "./journal"
import type { DagEventPage, DagFileStore } from "./store"
import { DAG_SETTINGS_DEFAULTS } from "./types"
import type {
  AmendRecord,
  DagBottleneck,
  DagDiagnostic,
  DagEdge,
  DagEventLane,
  DagNode,
  DagNodeCounts,
  DagNodeId,
  DagRunEvent,
  DagRunId,
  DagRunSnapshot,
  DagRunStatus,
  DagSettings,
  DagWave,
} from "./types"

const LIST_DEFAULT_LIMIT = 100
const LIST_MAX_LIMIT = 256

// Fixed scheduler identity of this engine: the fingerprint must change if these semantics change.
// waveAdmission moved strict-barrier -> dependency-frontier on 2026-08-25 (dag_530ad299): old
// runs keyed under the barrier fingerprint are deliberately not reused by the new semantics.
const SCHEDULER_FINGERPRINT_INPUT = {
  waveAdmission: "dependency-frontier",
  failurePolicy: "continue-independent",
  dependencyData: "filesystem-only",
} as const

export const DAG_MANAGER_ERROR_CODES = [
  "invalid_definition",
  "definition_conflict",
  "run_not_found",
  "run_not_owned",
  "invalid_arguments",
  "invalid_amendment",
  "amend_running_node",
  "run_still_active",
] as const

export type DagManagerErrorCode = (typeof DAG_MANAGER_ERROR_CODES)[number]

/**
 * Raised by every DagManager rejection path. `code` is the wire vocabulary the dag tool and the RPC
 * handlers surface verbatim; `errors`/`diagnostics` carry compile detail for `invalid_definition`.
 */
export class DagManagerError extends Error {
  readonly code: DagManagerErrorCode
  readonly runId?: DagRunId
  readonly errors: readonly DagCompileError[]
  readonly diagnostics: readonly DagDiagnostic[]
  readonly nodeIds: readonly DagNodeId[]

  constructor(input: {
    readonly code: DagManagerErrorCode
    readonly message: string
    readonly runId?: DagRunId
    readonly errors?: readonly DagCompileError[]
    readonly diagnostics?: readonly DagDiagnostic[]
    readonly nodeIds?: readonly DagNodeId[]
  }) {
    super(input.message)
    this.name = "DagManagerError"
    this.code = input.code
    if (input.runId !== undefined) this.runId = input.runId
    this.errors = input.errors ?? []
    this.diagnostics = input.diagnostics ?? []
    this.nodeIds = input.nodeIds ?? []
  }
}

// Persisted per node at creation time. `prompt` is the submitted original (the only fingerprinted
// text); `effectivePrompt` is dispatch material filled by the skill materialization seam.
export type DagPersistedNode = DagNodeInput & {
  readonly effectivePrompt: string
}

export type DagPersistedDefinition = {
  readonly key: string
  readonly name: string
  readonly nodes: readonly DagPersistedNode[]
}

export type { AmendRecord } from "./types"

export type DagRunRecordV1 = DagJournalCheckpoint & {
  readonly runId: DagRunId
  readonly runKey: string
  readonly name: string
  readonly parentSessionId: string
  readonly rootSessionId: string
  readonly definitionFingerprint: string
  readonly definition: DagPersistedDefinition
  readonly status: DagRunStatus
  readonly generation: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt?: string
  readonly completedAt?: string
  readonly nodes: readonly DagNode[]
  readonly edges: readonly DagEdge[]
  readonly waves: readonly DagWave[]
  readonly criticalPath: readonly DagNodeId[]
  readonly bottlenecks: readonly DagBottleneck[]
  readonly diagnostics: readonly DagDiagnostic[]
  readonly amendHistory?: readonly AmendRecord[]
  // Resume lease: recovery claims a paused run by writing the claiming host pid here and drops the
  // field on shutdown pause (see recovery.ts). Absent on records written before the lease existed.
  readonly leaseHolderPid?: number
  readonly previousLeaseHolderPid?: number
}

export type DagRunSummary = {
  readonly runId: DagRunId
  readonly runKey: string
  readonly name: string
  readonly parentSessionId: string
  readonly status: DagRunStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly counts: DagNodeCounts
}

export type DagStartResult = {
  readonly reused: boolean
  readonly snapshot: DagRunSnapshot
}

export type DagRunHandle = {
  readonly runId: DagRunId
  readonly snapshot: () => DagRunSnapshot
}

// Skill resolution happens once per execution definition: at creation, then only for changed/added
// nodes at amend. It fills effectivePrompt but never feeds the fingerprint. In particular,
// load_skills-only amendments remain fingerprint-unchanged and deliberately do not re-run nodes.
export type DagSkillMaterialization = {
  readonly nodes: readonly { readonly nodeId: string; readonly effectivePrompt: string }[]
  readonly diagnostics?: readonly DagDiagnostic[]
}

export type DagMaterializeSkills = (input: {
  readonly runId: DagRunId
  readonly definition: DagDefinition
  readonly at: string
}) => DagSkillMaterialization

export type DagManagerOptions = {
  readonly store: DagFileStore
  readonly newRunId?: () => DagRunId
  readonly now?: () => number
  readonly materializeSkills?: DagMaterializeSkills
  readonly settings?: Partial<DagSettings>
}

export type DagHistoryParams = {
  readonly runId: DagRunId
  readonly parentSessionId: string
  readonly sinceSeq?: number
  readonly limit?: number
  readonly lane?: DagEventLane
  readonly types?: readonly DagRunEventType[]
  readonly throughSeq?: number
}

export type DagStartParams = {
  readonly definition: DagDefinition
  readonly parentSessionId: string
  readonly rootSessionId: string
}

export type DagAmendParams = {
  readonly runId?: DagRunId
  readonly key?: string
  readonly definition: DagDefinition
  readonly parentSessionId: string
}

export type DagManager = {
  readonly start: (params: DagStartParams) => Promise<DagStartResult>
  readonly amend: (params: DagAmendParams) => Promise<DagRunRecordV1>
  readonly attach: (runId: DagRunId, parentSessionId: string) => DagRunHandle
  readonly snapshot: (runId: DagRunId, parentSessionId: string) => DagRunSnapshot
  readonly record: (runId: DagRunId, parentSessionId: string) => DagRunRecordV1
  readonly list: (parentSessionId: string, options?: { readonly limit?: number }) => readonly DagRunSummary[]
  readonly history: (params: DagHistoryParams) => DagEventPage
}

export function createDagManager(options: DagManagerOptions): DagManager {
  const store = options.store
  const now = options.now ?? Date.now
  const newRunId = options.newRunId ?? (() => `dag_${randomUUID()}` as DagRunId)
  const settings: DagSettings = { ...DAG_SETTINGS_DEFAULTS, ...options.settings }

  function ownedRecord(runId: DagRunId, parentSessionId: string): DagRunRecordV1 {
    const record = store.readCheckpoint<DagRunRecordV1>(runId)
    if (record === null) {
      throw new DagManagerError({ code: "run_not_found", message: `unknown dag run "${runId}"`, runId })
    }
    // Session ownership is absolute: a foreign caller that already knows the runId still gets no data.
    if (record.parentSessionId !== parentSessionId) {
      throw new DagManagerError({ code: "run_not_owned", message: `dag run "${runId}" belongs to another session`, runId })
    }
    return record
  }

  return {
    // start is async so every rejection path (invalid_definition, definition_conflict) reaches the
    // caller as a promise rejection rather than a synchronous throw.
    start: async (params) => startRun(params, {
      store,
      now,
      newRunId,
      settings,
      ...(options.materializeSkills === undefined ? {} : { materializeSkills: options.materializeSkills }),
    }),
    amend: async (params) => amendRun(params, {
      store,
      now,
      settings,
      ...(options.materializeSkills === undefined ? {} : { materializeSkills: options.materializeSkills }),
    }),
    attach(runId, parentSessionId) {
      ownedRecord(runId, parentSessionId)
      return {
        runId,
        snapshot: () => projectSnapshot(ownedRecord(runId, parentSessionId)),
      }
    },
    snapshot: (runId, parentSessionId) => projectSnapshot(ownedRecord(runId, parentSessionId)),
    record: ownedRecord,
    list(parentSessionId, listOptions) {
      const limit = resolveLimit(listOptions?.limit, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
      const summaries: DagRunSummary[] = []
      for (const entry of fs.readdirSync(store.paths.runs, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue
        const record = store.readCheckpoint<DagRunRecordV1>(entry.name.slice(0, -5) as DagRunId)
        if (record === null || record.parentSessionId !== parentSessionId) continue
        summaries.push({
          runId: record.runId,
          runKey: record.runKey,
          name: record.name,
          parentSessionId: record.parentSessionId,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          counts: countNodes(record.nodes),
        })
      }
      summaries.sort((a, b) => {
        const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
        if (byUpdated !== 0) return byUpdated
        return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0
      })
      return summaries.slice(0, limit)
    },
    history(params) {
      ownedRecord(params.runId, params.parentSessionId)
      const sinceSeq = params.sinceSeq ?? 0
      if (!Number.isInteger(sinceSeq) || sinceSeq < 0) {
        throw new DagManagerError({ code: "invalid_arguments", message: "sinceSeq must be a non-negative integer", runId: params.runId })
      }
      return store.readEvents(params.runId, sinceSeq, {
        limit: resolveLimit(params.limit, settings.history_default_limit, settings.history_max_limit),
        ...(params.lane === undefined ? {} : { lane: params.lane }),
        ...(params.types === undefined ? {} : { types: params.types }),
        ...(params.throughSeq === undefined ? {} : { throughSeq: params.throughSeq }),
      })
    },
  }
}

type StartContext = {
  readonly store: DagFileStore
  readonly now: () => number
  readonly newRunId: () => DagRunId
  readonly settings: DagSettings
  readonly materializeSkills?: DagMaterializeSkills
}

type AmendContext = Omit<StartContext, "newRunId">

type DagDefinitionAmendedMutationEvent = Extract<DagRunEvent, { readonly type: "dag.definition.amended" }> & {
  readonly definition: DagPersistedDefinition
  readonly nodes: readonly DagNode[]
  readonly edges: readonly DagEdge[]
  readonly waves: readonly DagWave[]
  readonly criticalPath: readonly DagNodeId[]
  readonly bottlenecks: readonly DagBottleneck[]
  readonly diagnostics: readonly DagDiagnostic[]
}

function startRun(params: DagStartParams, context: StartContext): DagStartResult {
  const at = new Date(context.now()).toISOString()
  const definition = params.definition

  // (1) validate + compile. Any error diagnostic creates no run, no key file, and no event.
  const compiled = compileDag(definition, { at, settings: context.settings })
  if (!compiled.ok) {
    throw new DagManagerError({
      code: "invalid_definition",
      message: compiled.errors.map((error) => error.message).join("; "),
      errors: compiled.errors,
      diagnostics: compiled.diagnostics,
    })
  }

  // (2) fingerprint the SUBMITTED definition: never effectivePrompt, never skill content.
  const definitionFingerprint = fingerprintDefinition(definition)

  // (3)+(4) under the key lock so a concurrent same-key start can never create a second run.
  return context.store.withKeyLock(params.parentSessionId, definition.key, () => {
    const existingKey = context.store.readKey(params.parentSessionId, definition.key)
    // A key whose run record is gone (retention pruned it) is stale, not a conflict: the key is
    // rewritten by the fresh run below. Conflict is reserved for a key with a LIVE divergent run.
    const existing = existingKey === null ? null : context.store.readCheckpoint<DagRunRecordV1>(existingKey.runId)
    if (existing !== null) {
      if (existing.definitionFingerprint !== definitionFingerprint) {
        throw new DagManagerError({
          code: "definition_conflict",
          message: `dag run key "${definition.key}" already exists with a different definition`,
          runId: existing.runId,
        })
      }
      // Reuse never re-materializes skills: the run keeps its creation-time effectivePrompt.
      return { reused: true, snapshot: projectSnapshot(existing) }
    }

    const runId = context.newRunId()
    const materialized = context.materializeSkills?.({ runId, definition, at })
    const effectivePrompts = new Map(
      (materialized?.nodes ?? []).map((node) => [node.nodeId, node.effectivePrompt] as const),
    )
    const record: DagRunRecordV1 = {
      schemaVersion: 1,
      checkpointSeq: 0,
      runId,
      runKey: definition.key,
      name: definition.name,
      parentSessionId: params.parentSessionId,
      rootSessionId: params.rootSessionId,
      definitionFingerprint,
      definition: {
        key: definition.key,
        name: definition.name,
        nodes: definition.nodes.map((node) => ({
          ...node,
          effectivePrompt: effectivePrompts.get(node.id) ?? node.prompt,
        })),
      },
      status: "pending",
      generation: 1,
      createdAt: at,
      updatedAt: at,
      nodes: compiled.nodes,
      edges: compiled.edges,
      waves: compiled.waves,
      criticalPath: compiled.criticalPath,
      bottlenecks: compiled.bottlenecks,
      diagnostics: [...compiled.diagnostics, ...(materialized?.diagnostics ?? [])],
    }

    // Journal skeleton first: the checkpoint must exist before the key file can point at it, so a
    // crash between the two leaves an unkeyed run rather than a key pointing at nothing.
    context.store.writeCheckpoint(runId, record)
    context.store.writeKey({
      schemaVersion: 1,
      parentSessionId: params.parentSessionId,
      runKey: definition.key,
      runId,
      definitionFingerprint,
    })
    const journal = createDagJournal<DagRunRecordV1>({
      store: context.store,
      runId,
      initialCheckpoint: record,
      applyEvent: applyRunEvent,
      now: context.now,
    })
    journal.append(dagRunCreatedEvent({
      runKey: definition.key,
      name: definition.name,
      definitionFingerprint,
      nodeCount: compiled.nodes.length,
      edgeCount: compiled.edges.length,
    }))
    return { reused: false, snapshot: projectSnapshot(journal.snapshot()) }
  })
}

function amendRun(params: DagAmendParams, context: AmendContext): DagRunRecordV1 {
  if ((params.runId === undefined) === (params.key === undefined)) {
    throw new DagManagerError({ code: "invalid_arguments", message: "amend requires exactly one of runId or key" })
  }
  const selectedRunId = params.runId ?? context.store.readKey(params.parentSessionId, params.key as string)?.runId
  if (selectedRunId === undefined) {
    throw new DagManagerError({ code: "run_not_found", message: `unknown dag run key "${params.key}"` })
  }
  const oldRecord = context.store.readCheckpoint<DagRunRecordV1>(selectedRunId)
  if (oldRecord === null) {
    throw new DagManagerError({ code: "run_not_found", message: `unknown dag run "${selectedRunId}"`, runId: selectedRunId })
  }
  if (oldRecord.parentSessionId !== params.parentSessionId) {
    throw new DagManagerError({ code: "run_not_owned", message: `dag run "${selectedRunId}" belongs to another session`, runId: selectedRunId })
  }
  if (oldRecord.status === "paused" && liveLeaseHolder(oldRecord)) {
    throw new DagManagerError({ code: "invalid_amendment", message: `dag run "${selectedRunId}" is paused by another live lease`, runId: selectedRunId })
  }

  const at = new Date(context.now()).toISOString()
  const compiled = compileDag(params.definition, { at, settings: context.settings })
  if (!compiled.ok) {
    throw new DagManagerError({
      code: "invalid_amendment",
      message: compiled.errors.map((error) => error.message).join("; "),
      runId: selectedRunId,
      errors: compiled.errors,
      diagnostics: compiled.diagnostics,
    })
  }
  if (params.definition.key !== oldRecord.runKey) {
    throw new DagManagerError({ code: "invalid_amendment", message: "an amendment cannot change the run key", runId: selectedRunId })
  }

  const diff = diffNodeFingerprints(
    oldRecord.definition.nodes.map(nodeFingerprintFromInput),
    params.definition.nodes.map(nodeFingerprintFromInput),
  )
  const unsafeIds = [...diff.changedIds, ...diff.removedIds].filter((id) => {
    const state = oldRecord.nodes.find((node) => node.id === id)?.state
    return state === "scheduled" || state === "running"
  })
  if (unsafeIds.length > 0) {
    throw new DagManagerError({
      code: "amend_running_node",
      message: `cannot amend scheduled or running nodes: ${unsafeIds.join(", ")}`,
      runId: selectedRunId,
      nodeIds: unsafeIds,
    })
  }
  if (oldRecord.status === "running") {
    throw new DagManagerError({ code: "run_still_active", message: `dag run "${selectedRunId}" is still active`, runId: selectedRunId })
  }

  const invalidatedIds = transitiveDependents(compiled.edges, [...diff.changedIds, ...diff.addedIds])
    .filter((id) => !diff.addedIds.includes(id))
  const materializedDefinition = materializeAmendedDefinition(
    context,
    oldRecord,
    params.definition,
    [...diff.changedIds, ...diff.addedIds],
    at,
  )
  const definitionFingerprint = fingerprintDefinition(params.definition)
  const oldNodes = new Map(oldRecord.nodes.map((node) => [node.id, node] as const))
  const invalidated = new Set(invalidatedIds)
  const nodes = compiled.nodes.map((compiledNode) => {
    const oldNode = oldNodes.get(compiledNode.id)
    if (oldNode === undefined) return compiledNode
    if (!invalidated.has(compiledNode.id)) return oldNode
    const { error: _error, resultArtifact: _resultArtifact, runStats: _runStats, completedAt: _completedAt, startedAt: _startedAt, ...kept } = oldNode as DagNode & {
      readonly resultArtifact?: unknown
    }
    return {
      ...kept,
      prompt: compiledNode.prompt,
      route: compiledNode.route,
      dependsOn: compiledNode.dependsOn,
      state: "pending" as const,
      execAttempt: (oldNode.execAttempt ?? 0) + 1,
    }
  })
  const mutation = {
    ...dagDefinitionAmendedEvent({
      previousFingerprint: oldRecord.definitionFingerprint,
      fingerprint: definitionFingerprint,
      changedNodeIds: diff.changedIds,
      addedNodeIds: diff.addedIds,
      invalidatedNodeIds: invalidatedIds,
    }),
    definition: materializedDefinition.definition,
    nodes,
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: materializedDefinition.diagnostics,
  }
  const journal = createDagJournal<DagRunRecordV1>({
    store: context.store,
    runId: selectedRunId,
    initialCheckpoint: oldRecord,
    applyEvent: applyDagRunMutation,
    now: context.now,
  })
  journal.append(mutation)
  context.store.writeKey({
    schemaVersion: 1,
    parentSessionId: oldRecord.parentSessionId,
    runKey: oldRecord.runKey,
    runId: selectedRunId,
    definitionFingerprint,
  })
  const amended = context.store.readCheckpoint<DagRunRecordV1>(selectedRunId)
  if (amended === null) throw new DagManagerError({ code: "run_not_found", message: `unknown dag run "${selectedRunId}"`, runId: selectedRunId })
  // The reducer no-ops instead of throwing (see applyDagRunMutation), so an unadvanced fingerprint is
  // how a lost race surfaces. Report it here, where the WAL is already durable and consistent.
  if (amended.definitionFingerprint !== definitionFingerprint) {
    throw new DagManagerError({
      code: "run_still_active",
      message: `dag run "${selectedRunId}" changed before the amendment could be applied`,
      runId: selectedRunId,
    })
  }
  return amended
}

export function applyDagRunMutation(record: DagRunRecordV1, event: DagRunEvent): DagRunRecordV1 {
  if (event.type === "dag.run.created") return { ...record, updatedAt: event.at }
  if (event.type === "dag.node.retried") {
    return {
      ...record,
      nodes: record.nodes.map((node) => {
        if (node.id !== event.nodeId) return node
        const { error: _error, resultArtifact: _resultArtifact, runStats: _runStats, completedAt: _completedAt, startedAt: _startedAt, ...kept } = node as DagNode & {
          readonly resultArtifact?: unknown
        }
        return { ...kept, state: "pending", execAttempt: event.execAttempt }
      }),
      updatedAt: event.at,
    }
  }
  if (event.type !== "dag.definition.amended") return record
  const mutation = event as DagDefinitionAmendedMutationEvent
  // This reducer runs as the journal's applyEvent, and the journal writes the WAL BEFORE applying it
  // (journal.ts appendPayload). Throwing from here would leave a durable event whose every replay
  // throws again, wedging the run permanently. So a precondition that no longer holds returns the
  // record UNCHANGED: replay stays idempotent, and amendRun below turns the unadvanced fingerprint
  // into the caller's typed refusal. amendRun re-checks all of these before appending, so reaching
  // one here means the run changed underneath a live amendment.
  if (record.definitionFingerprint !== event.previousFingerprint) return record
  const mutationNodeIds = new Set(mutation.nodes.map((node) => node.id))
  const removedNodeIds = record.nodes.filter((node) => !mutationNodeIds.has(node.id)).map((node) => node.id)
  const unsafeIds = [...event.changedNodeIds, ...removedNodeIds].filter((id) => {
    const state = record.nodes.find((node) => node.id === id)?.state
    return state === "scheduled" || state === "running"
  })
  if (unsafeIds.length > 0) return record
  if (record.status === "running") return record
  if (record.status === "paused" && liveLeaseHolder(record)) return record
  return {
    ...record,
    name: mutation.definition.name,
    definition: mutation.definition,
    definitionFingerprint: event.fingerprint,
    nodes: mutation.nodes,
    edges: mutation.edges,
    waves: mutation.waves,
    criticalPath: mutation.criticalPath,
    bottlenecks: mutation.bottlenecks,
    diagnostics: mutation.diagnostics,
    amendHistory: [...(record.amendHistory ?? []), {
      at: event.at,
      previousFingerprint: event.previousFingerprint,
      fingerprint: event.fingerprint,
      changedNodeIds: event.changedNodeIds,
      addedNodeIds: event.addedNodeIds,
      invalidatedNodeIds: event.invalidatedNodeIds,
    }],
    updatedAt: event.at,
  }
}

function applyRunEvent(record: DagRunRecordV1, event: DagRunEvent): DagRunRecordV1 {
  return applyDagRunMutation(record, event)
}

function nodeFingerprintFromInput(node: DagNodeInput): DagNodeFingerprintInputV1 {
  return {
    nodeId: node.id as DagNodeId,
    label: node.label ?? node.id,
    dependsOn: (node.dependsOn ?? []) as readonly DagNodeId[],
    prompt: node.prompt,
    route: node.category !== undefined
      ? { kind: "category", category: node.category }
      : { kind: "agent", agent: node.subagent_type, ...(node.model === undefined ? {} : { model: node.model }) },
    ...(node.task_summary === undefined ? {} : { taskSummary: node.task_summary }),
    ...(node.description === undefined ? {} : { description: node.description }),
    childName: node.id,
  }
}

function fingerprintDefinition(definition: DagDefinition): string {
  const nodes = definition.nodes.map(nodeFingerprintFromInput)
  return dagDefinitionFingerprint({ name: definition.name, scheduler: SCHEDULER_FINGERPRINT_INPUT, nodes })
}

function transitiveDependents(edges: readonly DagEdge[], seeds: readonly DagNodeId[]): DagNodeId[] {
  const dependents = new Map<DagNodeId, DagNodeId[]>()
  for (const edge of edges) dependents.set(edge.from, [...(dependents.get(edge.from) ?? []), edge.to])
  const visited = new Set<DagNodeId>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const id = queue.shift() as DagNodeId
    if (visited.has(id)) continue
    visited.add(id)
    queue.push(...(dependents.get(id) ?? []))
  }
  return [...visited]
}

function liveLeaseHolder(record: DagRunRecordV1): boolean {
  const pid = record.leaseHolderPid ?? record.previousLeaseHolderPid
  if (pid === undefined) return false
  return defaultSignaller.isAlive(pid)
}

function materializeAmendedDefinition(
  context: AmendContext,
  oldRecord: DagRunRecordV1,
  definition: DagDefinition,
  rematerializedIds: readonly DagNodeId[],
  at: string,
): { readonly definition: DagPersistedDefinition; readonly diagnostics: readonly DagDiagnostic[] } {
  const oldDefinition = new Map(oldRecord.definition.nodes.map((node) => [node.id, node] as const))
  if (context.materializeSkills === undefined || rematerializedIds.length === 0) {
    return {
      definition: {
        key: definition.key,
        name: definition.name,
        nodes: definition.nodes.map((node) => ({ ...node, effectivePrompt: oldDefinition.get(node.id)?.effectivePrompt ?? node.prompt })),
      },
      diagnostics: oldRecord.diagnostics,
    }
  }
  const manifestPath = join(context.store.paths.root, "skills", `${oldRecord.runId}.json`)
  const oldManifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { cwd?: string; nodes?: readonly { nodeId: string }[] } : undefined
  const selected = definition.nodes.filter((node) => rematerializedIds.includes(node.id as DagNodeId))
  const materialized = context.materializeSkills({ runId: oldRecord.runId, definition: { ...definition, nodes: selected }, at })
  const effective = new Map(materialized.nodes.map((node) => [node.nodeId, node.effectivePrompt] as const))
  if (oldManifest !== undefined && fs.existsSync(manifestPath)) {
    const freshManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { nodes?: readonly { nodeId: string }[] }
    const replaced = new Set(selected.map((node) => node.id))
    fs.writeFileSync(manifestPath, JSON.stringify({
      ...freshManifest,
      cwd: oldManifest.cwd,
      nodes: [...(oldManifest.nodes ?? []).filter((node) => !replaced.has(node.nodeId)), ...(freshManifest.nodes ?? [])],
    }), "utf8")
  }
  return {
    definition: {
      key: definition.key,
      name: definition.name,
      nodes: definition.nodes.map((node) => ({
        ...node,
        effectivePrompt: effective.get(node.id) ?? oldDefinition.get(node.id)?.effectivePrompt ?? node.prompt,
      })),
    },
    diagnostics: [...oldRecord.diagnostics, ...(materialized.diagnostics ?? [])],
  }
}

function projectSnapshot(record: DagRunRecordV1): DagRunSnapshot {
  return {
    schemaVersion: 1,
    runId: record.runId,
    runKey: record.runKey,
    name: record.name,
    parentSessionId: record.parentSessionId,
    rootSessionId: record.rootSessionId,
    status: record.status,
    generation: record.generation,
    createdAt: record.createdAt,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    definitionFingerprint: record.definitionFingerprint,
    lastSeq: record.checkpointSeq,
    nodes: record.nodes,
    edges: record.edges,
    waves: record.waves,
    criticalPath: record.criticalPath,
    bottlenecks: record.bottlenecks,
    diagnostics: record.diagnostics,
    counts: countNodes(record.nodes),
    ...(record.amendHistory === undefined ? {} : { amendHistory: record.amendHistory }),
    ...(record.leaseHolderPid === undefined ? {} : { leaseHolderPid: record.leaseHolderPid }),
  }
}

function countNodes(nodes: readonly DagNode[]): DagNodeCounts {
  const counts = {
    total: nodes.length,
    pending: 0,
    blocked: 0,
    scheduled: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  }
  for (const node of nodes) counts[node.state] += 1
  return counts
}

function resolveLimit(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined) return fallback
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new DagManagerError({ code: "invalid_arguments", message: `limit must be a positive integer, received ${requested}` })
  }
  return Math.min(requested, max)
}
