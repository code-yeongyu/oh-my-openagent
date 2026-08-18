// allow: SIZE_OK - the run lifecycle surface keeps key idempotency, session ownership, and snapshot projection on one contract so callers cannot bypass a step.
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"

import { dagRunCreatedEvent, type DagRunEventType } from "./events"
import { dagDefinitionFingerprint, type DagNodeFingerprintInputV1 } from "./fingerprint"
import { compileDag, type DagCompileError, type DagDefinition, type DagNodeInput } from "./graph"
import { createDagJournal, type DagJournalCheckpoint } from "./journal"
import type { DagEventPage, DagFileStore } from "./store"
import { DAG_SETTINGS_DEFAULTS } from "./types"
import type {
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
const SCHEDULER_FINGERPRINT_INPUT = {
  waveAdmission: "strict-barrier",
  failurePolicy: "continue-independent",
  dependencyData: "filesystem-only",
} as const

export const DAG_MANAGER_ERROR_CODES = [
  "invalid_definition",
  "definition_conflict",
  "run_not_found",
  "run_not_owned",
  "invalid_arguments",
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

  constructor(input: {
    readonly code: DagManagerErrorCode
    readonly message: string
    readonly runId?: DagRunId
    readonly errors?: readonly DagCompileError[]
    readonly diagnostics?: readonly DagDiagnostic[]
  }) {
    super(input.message)
    this.name = "DagManagerError"
    this.code = input.code
    if (input.runId !== undefined) this.runId = input.runId
    this.errors = input.errors ?? []
    this.diagnostics = input.diagnostics ?? []
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

// The todo 16 seam: skill resolution happens ONCE, at creation, and only fills effectivePrompt.
// It never feeds the fingerprint and is never re-run on reuse or resume.
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

export type DagManager = {
  readonly start: (params: DagStartParams) => Promise<DagStartResult>
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

// The manager owns only creation, so the sole journaled transition here is dag.run.created; the
// scheduler (todo 9) extends the reducer for wave and node events.
function applyRunEvent(record: DagRunRecordV1, event: DagRunEvent): DagRunRecordV1 {
  return event.type === "dag.run.created" ? { ...record, updatedAt: event.at } : record
}

function fingerprintDefinition(definition: DagDefinition): string {
  const nodes = definition.nodes.map((node): DagNodeFingerprintInputV1 => ({
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
  }))
  return dagDefinitionFingerprint({ name: definition.name, scheduler: SCHEDULER_FINGERPRINT_INPUT, nodes })
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
