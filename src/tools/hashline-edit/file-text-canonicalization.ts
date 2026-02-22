export interface FileTextEnvelope {
  content: string
  hadBom: boolean
  lineEnding: "\n" | "\r\n"
}

function detectLineEnding(content: string): "\n" | "\r\n" {
  return content.includes("\r\n") ? "\r\n" : "\n"
}

function stripBom(content: string): { content: string; hadBom: boolean } {
  if (!content.startsWith("\uFEFF")) {
    return { content, hadBom: false }
  }
  return { content: content.slice(1), hadBom: true }
}

function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function restoreLineEndings(content: string, lineEnding: "\n" | "\r\n"): string {
  if (lineEnding === "\n") return content
  return content.replace(/\n/g, "\r\n")
}

export function canonicalizeFileText(content: string): FileTextEnvelope {
  const stripped = stripBom(content)
  return {
    content: normalizeToLf(stripped.content),
    hadBom: stripped.hadBom,
    lineEnding: detectLineEnding(stripped.content),
  }
}

export function restoreFileText(content: string, envelope: FileTextEnvelope): string {
  const withLineEnding = restoreLineEndings(content, envelope.lineEnding)
  if (!envelope.hadBom) return withLineEnding
  return `\uFEFF${withLineEnding}`
}
