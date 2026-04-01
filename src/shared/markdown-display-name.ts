/**
 * Sanitize a display name for safe interpolation into markdown.
 * Strips backticks, pipe characters, and newlines that would break
 * markdown formatting (code spans, table cells, list items).
 */
export function sanitizeDisplayNameForMarkdown(name: string): string {
  return name.replace(/[`|\n\r]/g, "").trim()
}
