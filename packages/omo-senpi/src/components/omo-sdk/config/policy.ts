import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"

import type { OmoConfigReadFileSystem } from "@oh-my-opencode/omo-config-core"
import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { loadSenpiOmoConfig } from "../../config-resolution"
import { ok, type OmoResult, refused } from "../result"
import type { ConfigContext } from "."
import { ENGINE_DEFAULTS, engineKeySegments, engineView, readEngineLayers, valueAt } from "./engine"
import { ENGINE_PATH_PREFIX } from "./explain"
import { readModelSwaps, sessionFileFor } from "./model-swaps"
import { type PolicyFinding, policyFindings, ROUTING_KEYS, type RoutingChange } from "./policy-rules"

export type ConfigEdit = {
  /** A dotted omo key, an `engine:` key, or an omo key as segments; a `value` of undefined removes the key. */
  readonly path: string | readonly (string | number)[]
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
type Segment = string | number

const isRecord = (value: unknown): value is Doc => typeof value === "object" && value !== null && !Array.isArray(value)

function parseDocument(content: string): Doc {
  const parsed = parseJsoncSafe<unknown>(content)
  return parsed.errors.length === 0 && isRecord(parsed.data) ? parsed.data : {}
}

function withValue(document: Doc, path: readonly Segment[], value: unknown): Doc {
  const root = structuredClone(document)
  let current: Record<Segment, unknown> = root
  for (const segment of path.slice(0, -1)) {
    const next = current[segment]
    if (!isRecord(next)) current[segment] = {}
    current = current[segment] as Record<Segment, unknown>
  }
  const last = path.at(-1) as Segment
  if (value === undefined) delete current[last]
  else current[last] = value
  return root
}

const differs = (before: unknown, after: unknown): boolean => JSON.stringify(before) !== JSON.stringify(after)

function routingChanges(before: Doc, after: Doc): RoutingChange[] {
  return (["categories", "agents"] as const).flatMap((kind) => {
    const names = new Set([
      ...Object.keys(isRecord(before[kind]) ? before[kind] : {}),
      ...Object.keys(isRecord(after[kind]) ? after[kind] : {}),
    ])
    return [...names].flatMap((name) =>
      ROUTING_KEYS.filter((key) => differs(valueAt(before, [kind, name, key]), valueAt(after, [kind, name, key]))).map(
        (key) => ({ kind, name, key, path: `${kind}.${name}.${key}` }),
      ),
    )
  })
}

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

type ParsedEdit =
  | {
      readonly kind: "omo"
      readonly segments: readonly Segment[]
      readonly value: unknown
      readonly scope: "user" | "project"
    }
  | {
      readonly kind: "engine"
      readonly segments: readonly string[]
      readonly value: unknown
      readonly scope: "global" | "project"
    }

function parseEdit(edit: ConfigEdit): ParsedEdit | undefined {
  const scope = edit.scope ?? "user"
  if (typeof edit.path === "string" && edit.path.startsWith(ENGINE_PATH_PREFIX)) {
    const segments = engineKeySegments(edit.path.slice(ENGINE_PATH_PREFIX.length))
    return segments.some((segment) => segment.length === 0)
      ? undefined
      : { kind: "engine", segments, value: edit.value, scope: scope === "user" ? "global" : "project" }
  }
  const segments = typeof edit.path === "string" ? edit.path.split(".") : edit.path
  return segments.length === 0 || segments.some((segment) => segment === "")
    ? undefined
    : { kind: "omo", segments, value: edit.value, scope }
}

export function checkPolicy(context: ConfigContext, options: CheckOptions = {}): OmoResult<PolicyCheck> {
  const parsed = (options.edits ?? []).map((edit) => ({ edit, parsed: parseEdit(edit) }))
  const invalid = parsed.find((entry) => entry.parsed === undefined)
  if (invalid !== undefined)
    return refused("unknown_path", "an edit has an empty key path", "give every edit a dotted key path", {
      path: invalid.edit.path,
    })
  const edits = parsed.flatMap((entry) => (entry.parsed === undefined ? [] : [entry.parsed]))

  const base = loadSenpiOmoConfig({ cwd: context.cwd, env: context.env })
  const userPath = base.sources.find((source) => source.scope === "user")?.path
  const projectPath =
    base.sources.filter((source) => source.scope === "project").at(-1)?.path ?? join(context.cwd, ".omo", "omo.jsonc")
  const omoDocs = new Map<string, { readonly before: Doc; after: Doc }>()
  for (const edit of edits) {
    if (edit.kind !== "omo") continue
    const path = edit.scope === "project" ? projectPath : (userPath ?? projectPath)
    const entry =
      omoDocs.get(path) ??
      (() => {
        const before = existsSync(path) ? parseDocument(readFileSync(path, "utf-8")) : {}
        const created = { before, after: before }
        omoDocs.set(path, created)
        return created
      })()
    entry.after = withValue(entry.after, edit.segments, edit.value)
  }

  const engineLayers = readEngineLayers(context)
  const engineBefore = { global: engineLayers.global.document, project: engineLayers.project.document }
  const engineAfter: Record<"global" | "project", Doc> = { ...engineBefore }
  for (const edit of edits)
    if (edit.kind === "engine") engineAfter[edit.scope] = withValue(engineAfter[edit.scope], edit.segments, edit.value)

  const overlay = new Map([...omoDocs].map(([path, docs]) => [path, JSON.stringify(docs.after)]))
  const config =
    overlay.size === 0
      ? base.config
      : loadSenpiOmoConfig({ cwd: context.cwd, env: context.env, fileSystem: overlayFileSystem(overlay) }).config
  const engineChanges = Object.keys(ENGINE_DEFAULTS).filter((key) =>
    (["global", "project"] as const).some((scope) =>
      differs(valueAt(engineBefore[scope], key.split(".")), valueAt(engineAfter[scope], key.split("."))),
    ),
  )
  const sessionFile = sessionFileFor(options.session, context)
  return ok({
    findings: policyFindings({
      edited: edits.length > 0,
      routingChanges: [...omoDocs.values()].flatMap((docs) => routingChanges(docs.before, docs.after)),
      engineChanges,
      config,
      engine: engineView(engineAfter.global, engineAfter.project, context.engineVersion()),
      ...(sessionFile === undefined ? {} : { swaps: readModelSwaps(sessionFile) }),
    }),
  })
}
