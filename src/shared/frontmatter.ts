import * as yaml from "yaml"

export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T
  body: string
}

export function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): FrontmatterResult<T> {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { data: {} as T, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]

  try {
    const data = yaml.parse(yamlContent) as T
    return { data: data ?? ({} as T), body }
  } catch {
    // Fallback to empty data if YAML parsing fails
    return { data: {} as T, body }
  }
}
