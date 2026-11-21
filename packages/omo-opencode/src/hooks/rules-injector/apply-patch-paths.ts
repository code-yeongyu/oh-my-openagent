const PATCH_TEXT_FIELDS = ["patchText", "input", "patch"] as const
const ADD_HEADER = "*** Add File:"
const UPDATE_HEADER = "*** Update File:"
const MOVE_HEADER = "*** Move to:"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Paths from opencode's apply_patch result metadata (`files[]`, absolute paths),
 * or undefined when the metadata carries no usable file list.
 */
function readMetadataPaths(metadata: unknown): string[] | undefined {
  if (!isRecord(metadata) || !Array.isArray(metadata.files)) return undefined

  let listed = false
  const paths: string[] = []
  for (const file of metadata.files) {
    if (!isRecord(file) || typeof file.filePath !== "string") continue
    listed = true
    if (file.type === "delete") continue
    paths.push(typeof file.movePath === "string" ? file.movePath : file.filePath)
  }
  return listed ? paths : undefined
}

/** Paths from the patch headers; a `*** Move to:` line replaces the update it follows. */
function readPatchHeaderPaths(args: unknown): string[] {
  if (!isRecord(args)) return []
  const field = PATCH_TEXT_FIELDS.find((key) => typeof args[key] === "string")
  if (field === undefined) return []

  const paths: string[] = []
  let updateIndex: number | undefined
  for (const line of (args[field] as string).split(/\r?\n/)) {
    if (line.startsWith(ADD_HEADER) || line.startsWith(UPDATE_HEADER)) {
      const header = line.startsWith(ADD_HEADER) ? ADD_HEADER : UPDATE_HEADER
      const path = line.slice(header.length).trim()
      updateIndex = undefined
      if (!path) continue
      paths.push(path)
      if (header === UPDATE_HEADER) updateIndex = paths.length - 1
    } else if (line.startsWith(MOVE_HEADER)) {
      const path = line.slice(MOVE_HEADER.length).trim()
      if (path && updateIndex !== undefined) paths[updateIndex] = path
      updateIndex = undefined
    } else if (line.startsWith("*** ")) {
      updateIndex = undefined
    }
  }
  return paths
}

/**
 * The files an apply_patch call left in place: added and updated files and move
 * targets, never deleted ones. The tool's own metadata wins over the patch headers.
 */
export function getApplyPatchTargetPaths(metadata: unknown, args: unknown): string[] {
  const paths = readMetadataPaths(metadata) ?? readPatchHeaderPaths(args)
  return [...new Set(paths)]
}
