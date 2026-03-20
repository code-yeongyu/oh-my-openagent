import type { LookAtArgs } from "./types"

export interface LookAtArgsWithAlias extends LookAtArgs {
  path?: string
}

export function normalizeArgs(args: LookAtArgsWithAlias): LookAtArgs {
  return {
    file_path: args.file_path ?? args.path,
    image_data: args.image_data,
    goal: args.goal ?? "",
  }
}

export function validateArgs(args: LookAtArgs): string | null {
  const hasFilePath = Boolean(args.file_path && args.file_path.length > 0)
  const hasImageData = Boolean(args.image_data && args.image_data.length > 0)

  if (hasFilePath && /^https?:\/\//i.test(args.file_path!)) {
    return "Error: Remote URLs are not supported for file_path. Download the file first or use a local path."
  }
  if (!hasFilePath && !hasImageData) {
    return `Error: Must provide either 'file_path' or 'image_data'. Usage:
- look_at(file_path="/path/to/file", goal="what to extract")
- look_at(image_data="base64_encoded_data", goal="what to extract")`
  }
  if (hasFilePath && hasImageData) {
    return "Error: Provide only one of 'file_path' or 'image_data', not both."
  }
  if (!args.goal) {
    return "Error: Missing required parameter 'goal'. Usage: look_at(file_path=\"/path/to/file\", goal=\"what to extract\")"
  }
  return null
}
