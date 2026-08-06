import { resolve } from "node:path"

import { isRecord } from "@oh-my-opencode/utils"

const PROJECT_ROOT_KEYS = ["directory", "worktree", "cwd", "projectRoot", "projectPath"] as const

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readPathRecordRoot(record: Record<string, unknown>): string | undefined {
  const path = record.path
  if (!isRecord(path)) return undefined

  return readStringField(path, "root") ?? readStringField(path, "cwd")
}

function readRecordRoot(record: Record<string, unknown>): string | undefined {
  for (const key of PROJECT_ROOT_KEYS) {
    const value = readStringField(record, key)
    if (value !== undefined) return value
  }

  const pathRoot = readPathRecordRoot(record)
  if (pathRoot !== undefined) return pathRoot

  const info = record.info
  if (!isRecord(info)) return undefined

  for (const key of PROJECT_ROOT_KEYS) {
    const value = readStringField(info, key)
    if (value !== undefined) return value
  }

  return readPathRecordRoot(info)
}

export function resolveCodegraphProjectRoot(properties: unknown, fallbackDirectory: string): string {
  if (!isRecord(properties)) return resolve(fallbackDirectory)

  return resolve(readRecordRoot(properties) ?? fallbackDirectory)
}
