export interface FrontmatterResult<T = Record<string, string>> {
  data: T
  body: string
}

export function parseFrontmatter<T = Record<string, string>>(
  content: string
): FrontmatterResult<T> {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { data: {} as T, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]

  const data: Record<string, string | boolean> = {}
  for (const line of yamlContent.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim()
      let value: string | boolean = line.slice(colonIndex + 1).trim()

      if (value === "true") value = true
      else if (value === "false") value = false

      data[key] = value
    }
  }

  return { data: data as T, body }
}
