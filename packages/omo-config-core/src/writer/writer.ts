import { dirname, join } from "node:path"
import { parseJsoncSafe } from "@oh-my-opencode/utils"
import { applyEdits, modify } from "jsonc-parser/lib/esm/main.js"
import { loadOmoConfig, resolveUserOmoConfigPath } from "../loader"
import {
  DEFAULT_WRITE_FILE_SYSTEM,
  OmoConfigWriteError,
  type ReadModifyWriteOmoConfigOptions,
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

function resolveWritePath(options: UpdateOmoConfigOptions): string {
  if (options.scope === "user") {
    return resolveUserOmoConfigPath(options.env, options.platform ?? process.platform)
  }
  return join(options.projectDir ?? process.cwd(), ".omo", "omo.jsonc")
}

function writeAtomically(path: string, content: string, fileSystem: typeof DEFAULT_WRITE_FILE_SYSTEM): void {
  const tempPath = `${path}.tmp`
  try {
    fileSystem.writeFileSync(tempPath, content, "utf-8")
    fileSystem.renameSync(tempPath, path)
  } catch (error) {
    try {
      if (fileSystem.existsSync(tempPath)) fileSystem.unlinkSync(tempPath)
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error)) throw cleanupError
    }
    throw new OmoConfigWriteError(path, "write", error)
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
    if (existed) content = fileSystem.readFileSync(path, "utf-8")
  } catch (error) {
    throw new OmoConfigWriteError(path, "read", error)
  }

  assertJsoncCanBeModified(path, content)

  const backupPath = existed ? `${path}.bak.${backupSuffix()}` : undefined
  if (backupPath !== undefined) {
    try {
      fileSystem.copyFileSync(path, backupPath)
    } catch (error) {
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

export function readModifyWriteOmoConfig(options: ReadModifyWriteOmoConfigOptions): UpdateOmoConfigResult {
  loadOmoConfig({
    cwd: options.cwd ?? options.projectDir ?? process.cwd(),
    env: options.env,
    fileSystem: options.fileSystem,
    platform: options.platform,
  })
  return updateOmoConfig(options)
}
