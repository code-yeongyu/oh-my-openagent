import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser/lib/esm/main.js"
import {
  DEFAULT_WRITE_FILE_SYSTEM,
  OmoConfigLayerSchema,
  applyOmoConfigEdit,
  loadOmoConfig,
  updateOmoConfig,
  type OmoConfigEdit,
  type OmoConfigWriteFileSystem,
} from "@oh-my-opencode/omo-config-core"
import { OhMyOpenCodeConfigSchema } from "../../config"
import { findUnknownKeyPaths } from "../../plugin-config/unknown-key-diagnostics"

export type EditorTarget = {
  readonly path: string
  readonly scope: "project" | "user"
  readonly exists: boolean
}

export type EditorSession = {
  readonly path: string
  readonly scope: "project" | "user"
  originalContent: string | undefined
  content: string
  config: Record<string, unknown>
  edits: OmoConfigEdit[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseDocument(content: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const data: unknown = parse(content.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new Error(`Invalid JSONC: ${errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join(", ")}`)
  }
  if (!isRecord(data)) throw new Error("Configuration must be a JSON object.")
  return data
}

export function discoverEditorTargets(directory: string, env = process.env): readonly EditorTarget[] {
  const sources = loadOmoConfig({ cwd: directory, env }).sources
  const targets: EditorTarget[] = sources.map(({ path, scope, exists }) => ({ path, scope, exists }))
  const projectDirectory = join(resolve(directory), ".omo")
  if (!targets.some((target) => dirname(target.path) === projectDirectory)) {
    const jsonPath = join(projectDirectory, "omo.json")
    const path = existsSync(jsonPath) ? jsonPath : join(projectDirectory, "omo.jsonc")
    targets.push({ path, scope: "project", exists: existsSync(path) })
  }
  return targets
}

function assertSafeTarget(path: string): void {
  for (const candidate of [path, dirname(path)]) {
    try {
      const stats = lstatSync(candidate)
      if (stats.isSymbolicLink()) throw new Error(`Refusing to edit symbolic link: ${candidate}`)
      if (candidate === path && !stats.isFile()) throw new Error(`Configuration is not a regular file: ${path}`)
    } catch (error) {
      if (!(error instanceof Error) || Reflect.get(error, "code") !== "ENOENT") throw error
    }
  }
}

export function openEditorSession(path: string, scope: "project" | "user"): EditorSession {
  const absolutePath = resolve(path)
  assertSafeTarget(absolutePath)
  const originalContent = existsSync(absolutePath) ? readFileSync(absolutePath, "utf-8") : undefined
  const content = originalContent ?? "// OMO configuration\n{\n}\n"
  return { path: absolutePath, scope, originalContent, content, config: parseDocument(content), edits: [] }
}

export function readEditorValue(session: EditorSession, path: readonly string[]): unknown {
  const value = path.reduce<unknown>((entry, key) => isRecord(entry) && Object.hasOwn(entry, key) ? entry[key] : undefined, session.config)
  return structuredClone(value)
}

function intersects(left: readonly PropertyKey[], right: readonly PropertyKey[]): boolean {
  return left.slice(0, Math.min(left.length, right.length)).every((part, index) => part === right[index])
}

function validateEdit(config: Record<string, unknown>, path: readonly string[]): void {
  const rootResult = OmoConfigLayerSchema.safeParse(config)
  const issues = rootResult.success ? [] : rootResult.error.issues
  const blocks = [{ prefix: ["[opencode]"], value: config["[opencode]"] }]
  if (isRecord(config.profiles)) {
    for (const [name, profile] of Object.entries(config.profiles)) {
      if (isRecord(profile)) blocks.push({ prefix: ["profiles", name, "[opencode]"], value: profile["[opencode]"] })
    }
  }
  const scopedIssues = blocks.flatMap(({ prefix, value }) => {
    const result = isRecord(value) ? OhMyOpenCodeConfigSchema.safeParse(value) : undefined
    return result !== undefined && !result.success
      ? result.error.issues.map((issue) => ({ ...issue, path: [...prefix, ...issue.path] }))
      : []
  })
  const unknownPaths = blocks.flatMap(({ prefix, value }) => isRecord(value)
    ? findUnknownKeyPaths(OhMyOpenCodeConfigSchema, value).map((unknownPath) => [...prefix, ...unknownPath])
    : []).filter((unknownPath) => intersects(unknownPath, path))
  if (unknownPaths.length > 0) {
    throw new Error(`Unrecognized configuration field: ${unknownPaths.map((unknownPath) => unknownPath.join(".")).join(", ")}`)
  }
  const invalid = [...issues, ...scopedIssues].filter((issue) => issue.code === "unrecognized_keys"
    ? issue.keys.some((key) => intersects([...issue.path, key], path))
    : intersects(issue.path, path))
  if (invalid.length > 0) throw new Error(invalid.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"))
}

function assertSafeValue(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeValue(entry)
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`Reserved configuration key: ${key}`)
      assertSafeValue(entry)
    }
  }
}

export function setEditorValue(session: EditorSession, path: readonly string[], value: unknown): void {
  if (path.length === 0 || path.some((key) => ["__proto__", "constructor", "prototype"].includes(key))) {
    throw new Error("Choose a safe configuration field.")
  }
  assertSafeValue(value)
  if (isDeepStrictEqual(readEditorValue(session, path), value)) return
  const content = applyOmoConfigEdit(session.content, { path, value })
  const config = parseDocument(content)
  validateEdit(config, path)
  session.content = content
  session.config = config
  session.edits.push({ path: [...path], value: structuredClone(value) })
}

export function withEditorTransaction(session: EditorSession, operation: (staged: EditorSession) => void): void {
  const staged: EditorSession = {
    ...session,
    config: structuredClone(session.config),
    edits: structuredClone(session.edits),
  }
  operation(staged)
  session.content = staged.content
  session.config = staged.config
  session.edits = staged.edits
}

export function isEditorModified(session: EditorSession): boolean {
  const original = parseDocument(session.originalContent ?? "{}")
  return !isDeepStrictEqual(original, session.config)
}

function assertUnchanged(session: EditorSession): void {
  assertSafeTarget(session.path)
  const actual = existsSync(session.path) ? readFileSync(session.path, "utf-8") : undefined
  if (actual !== session.originalContent) throw new Error("Configuration changed on disk. Reopen the editor before saving; your edits have not been written.")
}

export function saveEditorSession(
  session: EditorSession,
  options: { readonly fileSystem?: OmoConfigWriteFileSystem } = {},
): { readonly path: string; readonly backupPath?: string } {
  if (!isEditorModified(session)) return { path: session.path }
  assertUnchanged(session)
  const fileSystem = options.fileSystem ?? DEFAULT_WRITE_FILE_SYSTEM
  const mode = existsSync(session.path) ? lstatSync(session.path).mode & 0o777 : 0o600
  const result = updateOmoConfig({
    scope: session.scope,
    targetPath: session.path,
    edits: session.edits,
    fileSystem: {
      ...fileSystem,
      readFileSync(path, encoding) {
        const content = fileSystem.readFileSync(path, encoding)
        if (path === session.path && content !== session.originalContent) throw new Error("Configuration changed on disk before save.")
        return content
      },
      writeFileExclusiveSync(path, content) {
        if (options.fileSystem === undefined) {
          writeFileSync(path, content, { encoding: "utf-8", flag: "wx", mode })
        } else {
          fileSystem.writeFileExclusiveSync(path, content)
        }
        chmodSync(path, mode)
      },
      renameSync(from, to) {
        assertUnchanged(session)
        fileSystem.renameSync(from, to)
      },
    },
  })
  session.originalContent = readFileSync(session.path, "utf-8")
  session.content = session.originalContent
  session.config = parseDocument(session.content)
  session.edits = []
  return result
}
