import { createHash } from "node:crypto"

import type { DagOwnerFingerprintInput } from "./owner"
import type { DagNodeId, DagRoute } from "./types"

export type DagNodeFingerprintInputV1 = {
  readonly nodeId: DagNodeId
  readonly label: string
  readonly dependsOn: readonly DagNodeId[]
  // The ORIGINAL prompt exactly as the user submitted it: never effectivePrompt,
  // never skill content, never skill digests.
  readonly prompt: string
  readonly route: DagRoute
  readonly taskSummary?: string
  readonly description?: string
  readonly childName: string
}

export type DagDefinitionFingerprintInputV1 = {
  readonly name: string
  readonly scheduler: {
    // Frontier admission since 2026-08-25: a node starts once every dependsOn node completed and
    // a slot is free; waves are informational groupings only (was "strict-barrier").
    readonly waveAdmission: "dependency-frontier"
    readonly failurePolicy: "continue-independent"
    readonly dependencyData: "filesystem-only"
  }
  readonly nodes: readonly DagNodeFingerprintInputV1[]
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined }

function canonicalize(value: JsonValue | undefined): string {
  if (value === undefined) {
    return ""
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${(value as readonly JsonValue[]).map((entry) => canonicalize(entry)).join(",")}]`
  }
  const record = value as { readonly [key: string]: JsonValue | undefined }
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
  return `{${entries.join(",")}}`
}

export function dagFingerprint(value: JsonValue): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex")
}

export function nodeFingerprintInput(input: DagNodeFingerprintInputV1): DagNodeFingerprintInputV1 {
  return { ...input, dependsOn: [...input.dependsOn].sort() }
}

export function dagDefinitionFingerprint(input: DagDefinitionFingerprintInputV1): string {
  const nodes = input.nodes.map(nodeFingerprintInput).sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))
  return dagFingerprint({ name: input.name, scheduler: input.scheduler, nodes })
}

export function ownerFingerprintInput(input: DagOwnerFingerprintInput): JsonValue {
  if (input.execAttempt && input.execAttempt >= 1) {
    return {
      definitionFingerprint: input.definitionFingerprint,
      nodeId: input.nodeId,
      execAttempt: input.execAttempt,
    }
  }
  return {
    definitionFingerprint: input.definitionFingerprint,
    nodeId: input.nodeId,
  }
}

export function diffNodeFingerprints(
  oldNodes: readonly DagNodeFingerprintInputV1[],
  newNodes: readonly DagNodeFingerprintInputV1[],
): {
  readonly unchangedIds: readonly DagNodeId[]
  readonly changedIds: readonly DagNodeId[]
  readonly addedIds: readonly DagNodeId[]
  readonly removedIds: readonly DagNodeId[]
} {
  const oldFingerprints = new Map<DagNodeId, string>()
  for (const node of oldNodes) {
    oldFingerprints.set(node.nodeId, dagFingerprint(nodeFingerprintInput(node)))
  }

  const newFingerprints = new Map<DagNodeId, string>()
  const unchangedIds: DagNodeId[] = []
  const changedIds: DagNodeId[] = []
  const addedIds: DagNodeId[] = []

  for (const node of newNodes) {
    const fingerprint = dagFingerprint(nodeFingerprintInput(node))
    newFingerprints.set(node.nodeId, fingerprint)
    const oldFingerprint = oldFingerprints.get(node.nodeId)
    if (oldFingerprint === undefined) {
      addedIds.push(node.nodeId)
    } else if (oldFingerprint === fingerprint) {
      unchangedIds.push(node.nodeId)
    } else {
      changedIds.push(node.nodeId)
    }
  }

  const removedIds: DagNodeId[] = []
  for (const node of oldNodes) {
    if (!newFingerprints.has(node.nodeId)) {
      removedIds.push(node.nodeId)
    }
  }

  return { unchangedIds, changedIds, addedIds, removedIds }
}
