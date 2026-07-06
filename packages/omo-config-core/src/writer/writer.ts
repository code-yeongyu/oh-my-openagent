import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { applyEdits, modify } from "jsonc-parser/lib/esm/main.js"
import { resolveUserOmoConfigPath } from "../loader"
import {
  DEFAULT_WRITE_FILE_SYSTEM,
  OmoConfigWriteError,
  type UpdateOmoConfigOptions,
  type UpdateOmoConfigResult,
} from "./types"

const EMPTY_OMO_CONFIG = `// OMO configuration
{
}
`

const FORMATTING_OPTIONS = {
  eol: "\n",
  insertSpaces: true,
  tabSize: 2,
}

function backupSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST"
}

function backupCandidate(basePath: string, attempt: number): string {
  return attempt === 0 ? basePath : `${basePath}.${attempt}`
}

function writeBackup(path: string, content: string, fileSystem: typeof DEFAULT_WRITE_FILE_SYSTEM): string {
  const basePath = `${path}.bak.${backupSuffix()}`
  let attempt = 0

  while (true) {
    const candidate = backupCandidate(basePath, attempt)
    try {
      fileSystem.writeFileExclusiveSync(candidate, content)
      return candidate
    } catch (error) {
      if (!isFileExistsError(error)) throw error
      attempt += 1
    }
  }
}

function resolveWritePath(options: UpdateOmoConfigOptions): string {
  const fileSystem = options.fileSystem ?? DEFAULT_WRITE_FILE_SYSTEM
  if (options.scope === "user") {
    const jsoncPath = resolveUserOmoConfigPath(options.env, options.platform ?? process.platform)
    if (fileSystem.existsSync(jsoncPath)) return jsoncPath
    const jsonPath = join(dirname(jsoncPath), "omo.json")
    return fileSystem.existsSync(jsonPath) ? jsonPath : jsoncPath
  }
  const jsoncPath = join(options.projectDir ?? process.cwd(), ".omo", "omo.jsonc")
  if (fileSystem.existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(dirname(jsoncPath), "omo.json")
  return fileSystem.existsSync(jsonPath) ? jsonPath : jsoncPath
}

function writeAtomically(path: string, content: string, fileSystem: typeof DEFAULT_WRITE_FILE_SYSTEM): void {
  const tempPath = `${path}.${randomUUID()}.tmp`
  let tempCreated = false
  try {
    fileSystem.writeFileExclusiveSync(tempPath, content)
    tempCreated = true
    fileSystem.renameSync(tempPath, path)
  } catch (error) {
    try {
      if (tempCreated) fileSystem.unlinkSync(tempPath)
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error)) throw cleanupError
    }
    throw new OmoConfigWriteError(path, "write", error)
  }
}

function assertConfigPathIsSafe(path: string, fileSystem: typeof DEFAULT_WRITE_FILE_SYSTEM): void {
  try {
    if (fileSystem.lstatSync(path).isSymbolicLink()) {
      throw new OmoConfigWriteError(path, "read", new Error("Refusing to edit symlinked omo config"))
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError) throw error
    throw new OmoConfigWriteError(path, "read", error)
  }
}

function assertProjectConfigDirectoryIsSafe(directory: string, fileSystem: typeof DEFAULT_WRITE_FILE_SYSTEM): void {
  try {
    if (fileSystem.lstatSync(directory).isSymbolicLink()) {
      throw new OmoConfigWriteError(
        directory,
        "read",
        new Error("Refusing to edit config under symlinked project .omo directory"),
      )
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError) throw error
    throw new OmoConfigWriteError(directory, "read", error)
  }
}

function assertJsoncCanBeModified(path: string, content: string): void {
  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length === 0) return

  const message = parsed.errors.map((error) => `${error.message} at offset ${error.offset}`).join(", ")
  throw new OmoConfigWriteError(path, "parse", new SyntaxError(message))
}

export function updateOmoConfig(options: UpdateOmoConfigOptions): UpdateOmoConfigResult {
  const fileSystem = options.fileSystem ?? DEFAULT_WRITE_FILE_SYSTEM
  const path = resolveWritePath(options)
  const directory = dirname(path)
  const existed = fileSystem.existsSync(path)
  let content = EMPTY_OMO_CONFIG

  try {
    fileSystem.mkdirSync(directory, { recursive: true })
    if (options.scope === "project") assertProjectConfigDirectoryIsSafe(directory, fileSystem)
    if (existed) {
      assertConfigPathIsSafe(path, fileSystem)
      content = fileSystem.readFileSync(path, "utf-8")
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError) throw error
    throw new OmoConfigWriteError(path, "read", error)
  }

  assertJsoncCanBeModified(path, content)

  let backupPath: string | undefined
  if (existed) {
    try {
      assertConfigPathIsSafe(path, fileSystem)
      backupPath = writeBackup(path, content, fileSystem)
    } catch (error) {
      if (error instanceof OmoConfigWriteError) throw error
      throw new OmoConfigWriteError(path, "backup", error)
    }
  }

  let nextContent = content
  for (const edit of options.edits) {
    nextContent = applyEdits(
      nextContent,
      modify(nextContent, [...edit.path], edit.value, { formattingOptions: FORMATTING_OPTIONS }),
    )
  }

  writeAtomically(path, nextContent, fileSystem)
  return backupPath === undefined ? { path } : { backupPath, path }
}
