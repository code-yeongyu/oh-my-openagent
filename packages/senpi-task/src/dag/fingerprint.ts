import { createHash } from "node:crypto"

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
    readonly waveAdmission: "strict-barrier"
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
