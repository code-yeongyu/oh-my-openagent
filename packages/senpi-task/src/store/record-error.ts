import { basename } from "node:path"

// Only exhausted Windows rename holds use the spawn-bookkeeping fallback classification.
export class TaskRecordWriteError extends Error {
  constructor(readonly failure: unknown) {
    super(describeRecordError(failure), { cause: failure })
    this.name = "TaskRecordWriteError"
  }
}

export function describeRecordError(error: unknown): string {
  if (error instanceof TaskRecordWriteError) return error.message
  if (!(error instanceof Error)) return sanitizePaths(String(error))
  const code = "code" in error ? String(error.code) : error.name
  const errno = "errno" in error ? ` errno=${String(error.errno)}` : ""
  const path = "path" in error && typeof error.path === "string"
    ? ` file=${basename(error.path.replaceAll("\\", "/"))}` : ""
  return `${code}${errno}${path}: ${sanitizePaths(error.message)}`
}

function sanitizePaths(message: string): string {
  return message.replace(/(?:[A-Za-z]:[\\/]|\/)[^\s"'<>]+/g, path => basename(path.replaceAll("\\", "/")))
}
