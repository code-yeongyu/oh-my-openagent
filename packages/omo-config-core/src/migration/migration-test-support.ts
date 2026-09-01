import { isPlainObject } from "../internal/plain-object"
import { parseJsoncSafe } from "../internal/jsonc-parse"
import { toPosixPath } from "../internal/posix-path"
import type { MigrationFileSystem } from "./types"

function fileError(code: string, message: string): Error {
  const error = new Error(message)
  Object.defineProperty(error, "code", { value: code })
  return error
}

export class MemoryMigrationFileSystem implements MigrationFileSystem {
  readonly directories = new Set<string>()
  readonly files = new Map<string, string>()
  readonly operations: string[] = []

  private key(path: string): string {
    return toPosixPath(path)
  }

  copyFileSync(source: string, destination: string): void {
    this.files.set(this.key(destination), this.readFileSync(source, "utf-8"))
  }

  existsSync(path: string): boolean {
    return this.files.has(this.key(path)) || this.directories.has(this.key(path))
  }

  lstatSync(_path: string): { readonly isSymbolicLink: () => boolean } {
    return { isSymbolicLink: () => false }
  }

  mkdirSync(path: string, _options: { readonly recursive: true }): string | undefined {
    this.directories.add(this.key(path))
    this.operations.push(`mkdir:${this.key(path)}`)
    return undefined
  }

  readFileSync(path: string, _encoding: "utf-8"): string {
    const content = this.files.get(this.key(path))
    if (content === undefined) throw fileError("ENOENT", `Missing ${this.key(path)}`)
    return content
  }

  readdirSync(path: string): string[] {
    const prefix = path.endsWith("/") ? path : `${path}/`
    return [...this.files.keys()]
      .filter((file) => file.startsWith(prefix))
      .map((file) => file.slice(prefix.length))
      .filter((file) => !file.includes("/"))
  }

  removeIfContentsMatchSync(path: string, expected: string): boolean {
    if (this.files.get(this.key(path)) !== expected) return false
    this.files.delete(this.key(path))
    this.operations.push(`remove:${this.key(path)}`)
    return true
  }

  renameSync(oldPath: string, newPath: string): void {
    const content = this.readFileSync(oldPath, "utf-8")
    this.files.set(this.key(newPath), content)
    this.files.delete(this.key(oldPath))
    this.operations.push(`rename:${this.key(oldPath)}:${this.key(newPath)}`)
  }

  replaceIfContentsMatchSync(path: string, expected: string, content: string): boolean {
    if (this.files.get(this.key(path)) !== expected) return false
    this.files.set(this.key(path), content)
    this.operations.push(`replace:${this.key(path)}`)
    return true
  }

  unlinkSync(path: string): void {
    if (!this.files.delete(this.key(path))) throw fileError("ENOENT", `Missing ${this.key(path)}`)
    this.operations.push(`unlink:${this.key(path)}`)
  }

  writeFileExclusiveSync(path: string, content: string): void {
    if (this.files.has(this.key(path))) throw fileError("EEXIST", `Already exists ${this.key(path)}`)
    this.files.set(this.key(path), content)
    this.operations.push(`exclusive:${this.key(path)}`)
  }

  writeFileSync(path: string, content: string, _encoding: "utf-8"): void {
    this.files.set(this.key(path), content)
    this.operations.push(`write:${this.key(path)}`)
  }
}

export const migrationFixture = {
  env: { HOME: "/home/alice" },
  sourcePath: "/legacy/config.jsonc",
  targetPath: "/home/alice/.omo/omo.jsonc",
}

export function parseFile(fileSystem: MemoryMigrationFileSystem, path: string): Record<string, unknown> {
  const parsed = parseJsoncSafe<unknown>(fileSystem.readFileSync(path, "utf-8"))
  if (parsed.errors.length > 0 || !isPlainObject(parsed.data)) throw new Error(`Invalid JSONC at ${path}`)
  return parsed.data
}
