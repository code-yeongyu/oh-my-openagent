import type { LookAtArgs } from "./types"

export interface LookAtArgsWithAlias extends LookAtArgs {
  path?: string
}

interface NormalizedLookAtArgs extends LookAtArgs {
  _normalized_file_paths_from_singular?: boolean
  _normalized_image_data_list_from_singular?: boolean
}

function hasNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0
}

function hasValues(values: string[] | undefined): values is string[] {
  return Array.isArray(values) && values.length > 0
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function normalizeArgs(args: LookAtArgsWithAlias): LookAtArgs {
  const filePath = args.file_path ?? args.path
  const imageData = args.image_data
  const filePathsFromSingular = !args.file_paths && hasNonEmptyString(filePath)
  const imageDataListFromSingular = !args.image_data_list && hasNonEmptyString(imageData)

  const normalized: NormalizedLookAtArgs = {
    file_path: filePath,
    file_paths: args.file_paths ?? (filePathsFromSingular ? [filePath] : undefined),
    image_data: imageData,
    image_data_list: args.image_data_list ?? (imageDataListFromSingular ? [imageData] : undefined),
    goal: args.goal ?? "",
    _normalized_file_paths_from_singular: filePathsFromSingular || undefined,
    _normalized_image_data_list_from_singular: imageDataListFromSingular || undefined,
  }

  return normalized
}

export function validateArgs(args: LookAtArgs): string | null {
  const normalizedArgs = args as NormalizedLookAtArgs
  const filePath = args.file_path
  const hasFilePath = hasNonEmptyString(args.file_path)
  const hasFilePaths = Array.isArray(args.file_paths)
  const hasImageData = hasNonEmptyString(args.image_data)
  const hasImageDataList = Array.isArray(args.image_data_list)
  const filePathsFromSingular = normalizedArgs._normalized_file_paths_from_singular === true
  const imageDataListFromSingular = normalizedArgs._normalized_image_data_list_from_singular === true

  if (hasFilePath && hasFilePaths && !filePathsFromSingular) {
    return "Error: Provide either 'file_path' or 'file_paths', not both."
  }

  if (hasImageData && hasImageDataList && !imageDataListFromSingular) {
    return "Error: Provide either 'image_data' or 'image_data_list', not both."
  }

  if (hasFilePaths && !hasValues(args.file_paths)) {
    return "Error: 'file_paths' must contain at least one local file path."
  }

  if (hasImageDataList && !hasValues(args.image_data_list)) {
    return "Error: 'image_data_list' must contain at least one Base64 image string."
  }

  if (hasValues(args.file_paths)) {
    for (const filePath of args.file_paths) {
      if (!hasNonEmptyString(filePath)) {
        return "Error: 'file_paths' must contain only non-empty local file paths."
      }
      if (isRemoteUrl(filePath)) {
        return "Error: Remote URLs are not supported for file_paths. Download the file first or use a local path."
      }
    }
  }

  if (hasValues(args.image_data_list)) {
    for (const imageData of args.image_data_list) {
      if (!hasNonEmptyString(imageData)) {
        return "Error: 'image_data_list' must contain only non-empty Base64 image strings."
      }
    }
  }

  if (hasNonEmptyString(filePath) && isRemoteUrl(filePath)) {
    return "Error: Remote URLs are not supported for file_path. Download the file first or use a local path."
  }
  if (!hasFilePath && !hasValues(args.file_paths) && !hasImageData && !hasValues(args.image_data_list)) {
    return `Error: Must provide at least one of 'file_path', 'file_paths', 'image_data', or 'image_data_list'. Usage:
- look_at(file_path="/path/to/file", goal="what to extract")
- look_at(file_paths=["/path/to/file-1", "/path/to/file-2"], goal="what to extract")
- look_at(image_data="base64_encoded_data", goal="what to extract")`
  }
  if (!args.goal) {
    return "Error: Missing required parameter 'goal'. Usage: look_at(file_path=\"/path/to/file\", goal=\"what to extract\")"
  }
  return null
}
