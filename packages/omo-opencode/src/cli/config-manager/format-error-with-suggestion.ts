interface NodeError extends Error {
  code?: string
}

function isPermissionError(err: unknown): boolean {
  const nodeErr = err as NodeError
  return nodeErr?.code === "EACCES" || nodeErr?.code === "EPERM"
}

function isFileNotFoundError(err: unknown): boolean {
  const nodeErr = err as NodeError
  return nodeErr?.code === "ENOENT"
}

export function formatErrorWithSuggestion(err: unknown, context: string): string {
  if (isPermissionError(err)) {
    return `Permission denied: Cannot ${context}. Try running with elevated permissions or check file ownership.`
  }

  if (isFileNotFoundError(err)) {
    return `File not found while trying to ${context}. The file may have been deleted or moved.`
  }

  if (err instanceof SyntaxError) {
    return `JSON syntax error while trying to ${context}: ${err.message}. Check for missing commas, brackets, or invalid characters.`
  }

  const message = err instanceof Error ? err.message : String(err)

  if (message.includes("ENOSPC")) {
    return `Disk full: Cannot ${context}. Free up disk space and try again.`
  }

  if (message.includes("EROFS")) {
    return `Read-only filesystem: Cannot ${context}. Check if the filesystem is mounted read-only.`
  }

  return `Failed to ${context}: ${message}`
}
