import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { dirname, join } from "node:path"

import { buildSkillPrepend, createFsSkillLoader } from "../tools/task/skills"
import type { LoadedSkill, SkillLoader } from "../tools/task/types"
import type { DagNodeInput } from "./graph"
import type { DagMaterializeSkills } from "./manager"
import type { DagFileStore } from "./store"
import type { DagDiagnostic, DagNodeId, DagRunId } from "./types"

const SCHEMA_VERSION = 1

export type DagSkillDigest = {
  readonly name: string
  readonly sha256: string
}

// Everything the dispatcher and an auditor need about one node's skills, captured once at run
// creation. `prompt` is the submitted original; `effectivePrompt` is the dispatch material.
export type DagNodeSkillMaterialization = {
  readonly nodeId: string
  readonly requested: readonly string[]
  readonly resolved: readonly DagSkillDigest[]
  readonly missing: readonly string[]
  readonly prompt: string
  readonly effectivePrompt: string
}

// Persisted sidecar for a run. `cwd` is the PINNED run-creation working directory: dispatch and
// resume read this manifest instead of re-searching the filesystem, so a later cwd change or a
// SKILL.md edit can never alter an existing run.
export type DagSkillManifest = {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly runId: DagRunId
  readonly cwd: string
  readonly at: string
  readonly nodes: readonly DagNodeSkillMaterialization[]
}

export type DagSkillMaterializerOptions = {
  readonly store: DagFileStore
  readonly cwd: string
  readonly loadSkills?: SkillLoader
  readonly homeDir?: string
  readonly extraDirs?: readonly string[]
}

function manifestPath(store: DagFileStore, runId: DagRunId): string {
  return join(store.paths.root, "skills", `${runId}.json`)
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

// Third-party loaders may still expose only the v1 ready-to-prepend block. Native filesystem
// loaders also expose the parsed content + location so DAG materialization preserves the exact
// invocation wrapper used by direct task spawns.
function skillContent(loadSkills: SkillLoader, name: string, cwd: string): LoadedSkill | undefined {
  const resolution = loadSkills([name], cwd)
  if (resolution.resolved.length === 0) return undefined
  const loaded = resolution.skills?.find((skill) => skill.name === name)
  if (loaded !== undefined) return loaded
  const prefix = `<skill name="${name}">\n`
  const suffix = "\n</skill>\n\n"
  const block = resolution.prepend
  if (!block.startsWith(prefix) || !block.endsWith(suffix)) return undefined
  return { name, content: block.slice(prefix.length, block.length - suffix.length) }
}

function materializeNode(
  node: DagNodeInput,
  loadSkills: SkillLoader,
  cwd: string,
): { readonly node: DagNodeSkillMaterialization; readonly missing: readonly string[] } {
  const requested = node.load_skills ?? []
  const contents: LoadedSkill[] = []
  const missing: string[] = []
  for (const name of requested) {
    const content = skillContent(loadSkills, name, cwd)
    if (content === undefined) missing.push(name)
    else contents.push(content)
  }
  return {
    node: {
      nodeId: node.id,
      requested: [...requested],
      resolved: contents.map((skill) => ({ name: skill.name, sha256: sha256(skill.content) })),
      missing,
      prompt: node.prompt,
      effectivePrompt: buildSkillPrepend(contents, node.prompt),
    },
    missing,
  }
}

/**
 * Resolves every node's `load_skills` ONCE, at run creation, against a pinned cwd.
 *
 * Missing skills never fail the run: each one becomes a `missing_skill` node diagnostic and the
 * node keeps dispatching with whatever resolved. The resulting effectivePrompt and the `{name,
 * sha256}` digests are DISPATCH MATERIAL and audit metadata only - the run fingerprint covers the
 * submitted definition alone, so nothing here may ever reach it.
 */
export function createDagSkillMaterializer(options: DagSkillMaterializerOptions): DagMaterializeSkills {
  const cwd = options.cwd
  const loadSkills = options.loadSkills ?? createFsSkillLoader({
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.extraDirs === undefined ? {} : { extraDirs: options.extraDirs }),
  })
  return ({ runId, definition, at }) => {
    const nodes: DagNodeSkillMaterialization[] = []
    const diagnostics: DagDiagnostic[] = []
    for (const input of definition.nodes) {
      const materialized = materializeNode(input, loadSkills, cwd)
      nodes.push(materialized.node)
      for (const name of materialized.missing) {
        diagnostics.push({
          kind: "missing_skill",
          nodeId: input.id as DagNodeId,
          skill: name,
          message: `Skill "${name}" was not found.`,
          at,
        })
      }
    }
    const manifest: DagSkillManifest = { schemaVersion: SCHEMA_VERSION, runId, cwd, at, nodes }
    const path = manifestPath(options.store, runId)
    fs.mkdirSync(dirname(path), { recursive: true })
    fs.writeFileSync(path, JSON.stringify(manifest), "utf8")
    return {
      nodes: nodes.map((node) => ({ nodeId: node.nodeId, effectivePrompt: node.effectivePrompt })),
      diagnostics,
    }
  }
}

// Resume path: read the creation-time materialization, never SKILL.md.
export function readDagSkillManifest(store: DagFileStore, runId: DagRunId): DagSkillManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(store, runId), "utf8")) as DagSkillManifest
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}
