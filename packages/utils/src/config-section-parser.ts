import { isUnsafeObjectKey } from "./deep-merge"

type ConfigPathSegment = string | number | symbol

type ConfigParseIssue = {
  readonly path: readonly ConfigPathSegment[]
  readonly message: string
}

type ConfigParseError = {
  readonly issues: readonly ConfigParseIssue[]
}

type ConfigParseResult<TConfig> =
  | {
      readonly success: true
      readonly data: TConfig
    }
  | {
      readonly success: false
      readonly error: ConfigParseError
    }

type ConfigSectionParser<TConfig> = {
  safeParse(input: unknown): ConfigParseResult<TConfig>
}

type ParseConfigSectionsOptions = {
  readonly onInvalidSections?: (sections: readonly string[]) => void
}

function formatPath(path: readonly ConfigPathSegment[]): string {
  return path.map((segment) => String(segment)).join(".")
}

function formatSectionIssues(key: string, issues: readonly ConfigParseIssue[]): string | null {
  const sectionErrors = issues
    .filter((issue) => issue.path[0] === key)
    .map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
    .join(", ")

  if (!sectionErrors) return null
  return `${key}: ${sectionErrors}`
}

export function parseConfigSections<TConfig extends Record<string, unknown>>(
  schema: ConfigSectionParser<TConfig>,
  rawConfig: Record<string, unknown>,
  options: ParseConfigSectionsOptions = {},
): Partial<TConfig> {
  const fullResult = schema.safeParse(rawConfig)
  if (fullResult.success) {
    return fullResult.data
  }

  const partialConfig: Record<string, unknown> = {}
  const invalidSections: string[] = []

  for (const key of Object.keys(rawConfig)) {
    if (isUnsafeObjectKey(key)) continue

    const sectionResult = schema.safeParse({ [key]: rawConfig[key] })
    if (sectionResult.success) {
      const parsedValue = sectionResult.data[key]
      if (parsedValue !== undefined) {
        partialConfig[key] = parsedValue
      }
      continue
    }

    const sectionErrors = formatSectionIssues(key, sectionResult.error.issues)
    if (sectionErrors) {
      invalidSections.push(sectionErrors)
    }
  }

  if (invalidSections.length > 0) {
    options.onInvalidSections?.(invalidSections)
  }

  return partialConfig as Partial<TConfig>
}
