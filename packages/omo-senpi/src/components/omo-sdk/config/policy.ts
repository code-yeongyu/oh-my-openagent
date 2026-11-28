import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"

import type { OmoConfigReadFileSystem } from "@oh-my-opencode/omo-config-core"
import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { loadSenpiOmoConfig } from "../../config-resolution"
import { ok, type OmoResult } from "../result"
import type { ConfigContext } from "."
import { type AllowedPath, allowedPath, pathNotAllowed, segmentsOf } from "./allowlist"
import { ENGINE_DEFAULTS, engineView, isRecord, readEngineLayers, valueAt } from "./engine"
import { readModelSwaps, sessionFileFor } from "./model-swaps"
import { type PolicyFinding, policyFindings, type RoutingChange } from "./policy-rules"

export type ConfigEdit = {
  /** An allowlisted key: a dotted routing key or its segments, or an `engine:` key; a `value` of undefined removes it. */
  readonly path: string | readonly string[]
  readonly value: unknown
  /** The layer the edit lands in; `user` (the default) is the engine's global file for an `engine:` key. */
  readonly scope?: "user" | "project"
}

export type CheckOptions = {
  readonly edits?: readonly ConfigEdit[]
  /** A session record path or id for the fallback rules; the calling session's when omitted. */
  readonly session?: string
}

export type PolicyCheck = { readonly findings: readonly PolicyFinding[] }

type Doc = Record<string, unknown>
type ParsedEdit = { readonly allowed: AllowedPath; readonly value: unknown; readonly scope: "user" | "project" }

function parseDocument(content: string): Doc {
  const parsed = parseJsoncSafe<unknown>(content)
  return parsed.errors.length === 0 && isRecord(parsed.data) ? parsed.data : {}
}

function withValue(document: Doc, path: readonly string[], value: unknown): Doc {
  const root = structuredClone(document)
  let current: Doc = root
  for (const segment of path.slice(0, -1)) {
    const next = Object.hasOwn(current, segment) ? current[segment] : undefined
    if (!isRecord(next)) current[segment] = {}
    current = current[segment] as Doc
  }
  const last = path.at(-1) ?? ""
  if (value === undefined) delete current[last]
  else current[last] = value
  return root
}

const differs = (before: unknown, after: unknown): boolean => JSON.stringify(before) !== JSON.stringify(after)

function overlayFileSystem(overlay: ReadonlyMap<string, string>): OmoConfigReadFileSystem {
  return {
    existsSync: (path) => overlay.has(path) || existsSync(path),
    readFileSync: (path, encoding) => overlay.get(path) ?? readFileSync(path, encoding),
    lstatSync: (path) => (overlay.has(path) && !existsSync(path) ? { isSymbolicLink: () => false } : lstatSync(path)),
    realpathSync: (path) => {
      try {
        return realpathSync(path)
      } catch {
        return path
      }
    },
  }
}

type OmoDocs = { readonly before: Doc; after: Doc; readonly edited: Map<string, RoutingChange> }

function applyOmoEdits(context: ConfigContext, edits: readonly ParsedEdit[]) {
  const base = loadSenpiOmoConfig({ cwd: context.cwd, env: context.env })
  const userPath = base.sources.find((source) => source.scope === "user")?.path
  const projectPath =
    base.sources.filter((source) => source.scope === "project").at(-1)?.path ?? join(context.cwd, ".omo", "omo.jsonc")
  const docs = new Map<string, OmoDocs>()
  for (const { allowed, value, scope } of edits) {
    if (allowed.kind !== "routing") continue
    const path = scope === "project" ? projectPath : (userPath ?? projectPath)
    let entry = docs.get(path)
    if (entry === undefined) {
      const before = existsSync(path) ? parseDocument(readFileSync(path, "utf-8")) : {}
      entry = { before, after: before, edited: new Map() }
      docs.set(path, entry)
    }
    entry.after = withValue(entry.after, segmentsOf(allowed), value)
    entry.edited.set(allowed.path, { kind: allowed.root, name: allowed.name, key: allowed.key, path: allowed.path })
  }
  const overlay = new Map([...docs].map(([path, entry]) => [path, JSON.stringify(entry.after)]))
  const config =
    overlay.size === 0
      ? base.config
      : loadSenpiOmoConfig({ cwd: context.cwd, env: context.env, fileSystem: overlayFileSystem(overlay) }).config
  const routingChanges = [...docs.values()].flatMap(({ before, after, edited }) =>
    [...edited.values()].filter((change) => {
      const segments = change.path.split(".")
      return differs(valueAt(before, segments), valueAt(after, segments))
    }),
  )
  return { config, routingChanges }
}

export function checkPolicy(context: ConfigContext, options: CheckOptions = {}): OmoResult<PolicyCheck> {
  const edits: ParsedEdit[] = []
  for (const edit of options.edits ?? []) {
    const allowed = allowedPath(edit.path)
    if (allowed === undefined) return pathNotAllowed()
    edits.push({ allowed, value: edit.value, scope: edit.scope ?? "user" })
  }
  const { config, routingChanges } = applyOmoEdits(context, edits)

  const engineLayers = readEngineLayers(context)
  const engineBefore = { global: engineLayers.global.document, project: engineLayers.project.document }
  const engineAfter: Record<"global" | "project", Doc> = { ...engineBefore }
  for (const { allowed, value, scope } of edits) {
    if (allowed.kind === "routing") continue
    const layer = scope === "user" ? "global" : "project"
    engineAfter[layer] = withValue(engineAfter[layer], segmentsOf(allowed), value)
  }
  const engineChanges = Object.keys(ENGINE_DEFAULTS).filter((key) =>
    (["global", "project"] as const).some((scope) =>
      differs(valueAt(engineBefore[scope], key.split(".")), valueAt(engineAfter[scope], key.split("."))),
    ),
  )
  const sessionFile = sessionFileFor(options.session, context)
  return ok({
    findings: policyFindings({
      edited: edits.length > 0,
      routingChanges,
      engineChanges,
      config,
      engine: engineView(engineAfter.global, engineAfter.project),
      installedEngineVersion: context.engineVersion(),
      ...(sessionFile === undefined ? {} : { swaps: readModelSwaps(sessionFile) }),
    }),
  })
}
