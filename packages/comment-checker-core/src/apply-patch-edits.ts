import type { ApplyPatchAccumulator, ApplyPatchFileMetadata, CheckerEdit } from "./types"

export function extractApplyPatchEdits(
  details: unknown,
  args?: Record<string, unknown>,
): CheckerEdit[] {
  const metadataEdits = getApplyPatchMetadataFiles(details)
    .filter((file) => file.type?.toLowerCase() !== "delete")
    .map((file) => ({
      filePath: file.movePath ?? file.filePath,
      before: file.before,
      after: file.after,
    }))

  if (metadataEdits.length > 0) return metadataEdits

  const patch = args === undefined ? undefined : getString(args, ["patchText", "input", "patch", "command"])
  if (patch === undefined) return []

  return parseApplyPatchRequests(patch)
}

export function getApplyPatchMetadataFiles(details: unknown): ApplyPatchFileMetadata[] {
  if (!isRecord(details)) return []

  const direct = readApplyPatchMetadataFiles(details["files"])
  if (direct.length > 0) return direct

  const resultDetails = details["result"]
  const result = isRecord(resultDetails) ? readApplyPatchMetadataFiles(resultDetails["files"]) : []
  if (result.length > 0) return result

  const metadataDetails = details["metadata"]
  return isRecord(metadataDetails) ? readApplyPatchMetadataFiles(metadataDetails["files"]) : []
}

export function readApplyPatchMetadataFiles(value: unknown): ApplyPatchFileMetadata[] {
  if (!Array.isArray(value)) return []

  const files: ApplyPatchFileMetadata[] = []
  for (const item of value) {
    if (!isRecord(item)) continue

    const filePath = getString(item, ["filePath", "file_path", "path"])
    const movePath = getString(item, ["movePath", "move_path"])
    const before = getString(item, ["before", "old", "oldString", "old_string"])
    const after = getString(item, ["after", "new", "newString", "new_string"])
    const type = getString(item, ["type", "operation"])

    if (filePath === undefined || before === undefined || after === undefined) continue

    files.push({
      filePath,
      before,
      after,
      ...(movePath === undefined ? {} : { movePath }),
      ...(type === undefined ? {} : { type }),
    })
  }

  return files
}

export function parseApplyPatchRequests(patch: string): CheckerEdit[] {
  const edits: CheckerEdit[] = []
  let current: ApplyPatchAccumulator | undefined

  const flush = (): void => {
    if (current === undefined) return

    if (current.operation === "add") {
      const after = joinPatchLines(current.newLines)
      if (after.length > 0) {
        edits.push({ filePath: current.filePath, before: "", after })
      }
    }

    if (current.operation === "update") {
      const after = joinPatchLines(current.newLines)
      if (after.length > 0) {
        edits.push({
          filePath: current.movePath ?? current.filePath,
          before: joinPatchLines(current.oldLines),
          after,
        })
      }
    }

    current = undefined
  }

  for (const line of patch.split(/\r?\n/)) {
    if (line === "*** Begin Patch" || line === "*** End Patch") continue

    if (line.startsWith("*** Add File: ")) {
      flush()
      current = makeAccumulator("add", line.slice("*** Add File: ".length).trim())
      continue
    }

    if (line.startsWith("*** Update File: ")) {
      flush()
      current = makeAccumulator("update", line.slice("*** Update File: ".length).trim())
      continue
    }

    if (line.startsWith("*** Delete File: ")) {
      flush()
      current = makeAccumulator("delete", line.slice("*** Delete File: ".length).trim())
      continue
    }

    if (line.startsWith("*** Move to: ")) {
      if (current?.operation === "update") {
        current.movePath = line.slice("*** Move to: ".length).trim()
      }
      continue
    }

    if (current === undefined || line.startsWith("@@")) continue

    if (current.operation === "add") {
      if (line.startsWith("+")) current.newLines.push(line.slice(1))
      continue
    }

    if (current.operation === "update") {
      if (line.startsWith("-")) current.oldLines.push(line.slice(1))
      if (line.startsWith("+")) current.newLines.push(line.slice(1))
    }
  }

  flush()
  return edits
}

export function makeAccumulator(
  operation: ApplyPatchAccumulator["operation"],
  filePath: string,
): ApplyPatchAccumulator {
  return {
    operation,
    filePath,
    oldLines: [],
    newLines: [],
  }
}

export function getString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string") return value
  }

  return undefined
}

export function joinPatchLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
