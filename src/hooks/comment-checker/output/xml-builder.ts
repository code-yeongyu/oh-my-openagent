import type { FileComments } from "../types"

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export function buildCommentsXml(fileCommentsList: FileComments[]): string {
  const lines: string[] = []

  for (const fc of fileCommentsList) {
    lines.push(`<comments file="${escapeXml(fc.filePath)}">`)
    for (const comment of fc.comments) {
      lines.push(`\t<comment line-number="${comment.lineNumber}">${escapeXml(comment.text)}</comment>`)
    }
    lines.push(`</comments>`)
  }

  return lines.join("\n")
}
