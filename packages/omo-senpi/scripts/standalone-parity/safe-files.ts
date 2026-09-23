import { createHash } from "node:crypto"
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, sep } from "node:path"

import { StandaloneParityInputError } from "./contracts"

const FORBIDDEN_SEGMENTS = new Set([
  ".env",
  "auth.json",
  "cache",
  "credential-pool",
  "logs",
  "node_modules",
  "sessions",
])

export async function ensureRegularSourceRoot(path: string): Promise<string> {
  const initial = await lstat(path)
  if (initial.isSymbolicLink()) throw new StandaloneParityInputError(`symlink rejected: ${path}`)
  const resolved = await realpath(path)
  const stat = await lstat(resolved)
  if (!stat.isDirectory()) throw new StandaloneParityInputError(`source root is not a directory: ${path}`)
  return resolved
}

export async function listSafeFiles(root: string): Promise<readonly string[]> {
  const files: string[] = []
  await collect(root, root, files)
  return files.sort()
}

async function collect(root: string, current: string, files: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = join(current, entry.name)
    const relativePath = relative(root, candidate)
    if (hasForbiddenSegment(relativePath)) continue
    rejectUnsafeRelativePath(relativePath)
    const stat = await lstat(candidate)
    if (stat.isSymbolicLink()) throw new StandaloneParityInputError(`symlink rejected: ${candidate}`)
    if (stat.isDirectory()) {
      await collect(root, candidate, files)
      continue
    }
    if (!stat.isFile()) throw new StandaloneParityInputError(`non-regular file rejected: ${candidate}`)
    files.push(candidate)
  }
}

export function rejectUnsafeRelativePath(path: string): void {
  const segments = path.split(/[\\/]/)
  if (path.length === 0 || isAbsolute(path) || segments.includes("..") || hasForbiddenSegment(path)) {
    throw new StandaloneParityInputError(`forbidden path: ${path}`)
  }
}

function hasForbiddenSegment(path: string): boolean {
  return path.split(/[\\/]/).some((part) => FORBIDDEN_SEGMENTS.has(part))
}

export function relativeInside(root: string, path: string): string {
  const candidate = relative(root, path)
  if (candidate.length === 0 || candidate.startsWith(`..${sep}`) || candidate === "..") {
    throw new StandaloneParityInputError(`path escapes source root: ${path}`)
  }
  rejectUnsafeRelativePath(candidate)
  return candidate
}

export async function copyTree(source: string, destination: string): Promise<void> {
  const root = await ensureRegularSourceRoot(source)
  for (const file of await listSafeFiles(root)) {
    const output = join(destination, relativeInside(root, file))
    await mkdir(dirname(output), { recursive: true })
    await copyFile(file, output)
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

export async function hashTree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const file of await listSafeFiles(root)) files[relativeInside(root, file)] = await sha256(file)
  return files
}
