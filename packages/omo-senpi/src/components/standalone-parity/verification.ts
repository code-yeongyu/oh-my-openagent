import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

export interface RuntimeManifest {
  readonly skills: readonly string[]
  readonly instructionsPath: string
  readonly files: Readonly<Record<string, string>>
}

export interface RuntimeCommand {
  readonly name: string
  readonly description: string
  readonly template: string
}

export interface RuntimeMcp {
  readonly name: string
  readonly declaration: Record<string, unknown>
}

export class StandaloneParityRuntimeVerificationError extends Error {
  readonly name = "StandaloneParityRuntimeVerificationError"
}

export async function verifyRuntimePayload(root: string): Promise<RuntimeManifest> {
  const manifest = parseManifest(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")))
  for (const [path, expected] of Object.entries(manifest.files)) {
    const candidate = resolve(root, path)
    if (!isInside(root, candidate)) throw new StandaloneParityRuntimeVerificationError(`manifest path escapes payload: ${path}`)
    const actual = createHash("sha256").update(await readFile(candidate)).digest("hex")
    if (actual !== expected) throw new StandaloneParityRuntimeVerificationError(`hash mismatch: ${path}`)
  }
  return manifest
}

export function parseRuntimeCommands(value: unknown): readonly RuntimeCommand[] {
  if (!Array.isArray(value)) throw new Error("invalid generated commands")
  return value.map((command) => {
    if (!isRecord(command)) throw new Error("invalid generated command")
    const name = stringField(command, "name")
    const description = stringField(command, "description")
    const template = stringField(command, "template")
    if (name === undefined || description === undefined || template === undefined) throw new Error("invalid generated command")
    return { name, description, template }
  })
}

export function parseRuntimeMcps(value: unknown): readonly RuntimeMcp[] {
  if (!Array.isArray(value)) throw new Error("invalid generated MCP declarations")
  return value.map((mcp) => {
    if (!isRecord(mcp)) throw new Error("invalid generated MCP declaration")
    const name = stringField(mcp, "name")
    const declaration = recordField(mcp, "declaration")
    if (name === undefined || declaration === undefined) throw new Error("invalid generated MCP declaration")
    return { name, declaration }
  })
}

function parseManifest(value: unknown): RuntimeManifest {
  if (!isRecord(value) || Reflect.get(value, "version") !== 1) throw new StandaloneParityRuntimeVerificationError("invalid manifest")
  const skills = Reflect.get(value, "skills")
  const instructionsPath = stringField(value, "instructionsPath")
  const files = recordField(value, "files")
  if (!Array.isArray(skills) || !skills.every((skill) => typeof skill === "string") || instructionsPath === undefined || files === undefined) {
    throw new StandaloneParityRuntimeVerificationError("invalid manifest")
  }
  const hashes = Object.fromEntries(Object.entries(files).map(([path, hash]) => {
    if (typeof hash !== "string") throw new StandaloneParityRuntimeVerificationError("invalid manifest hash")
    return [path, hash]
  }))
  return { skills, instructionsPath, files: hashes }
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), candidate)
  return path.length > 0 && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = Reflect.get(value, key)
  return isRecord(field) ? field : undefined
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = Reflect.get(value, key)
  return typeof field === "string" ? field : undefined
}
