/**
 * Wraps every `<table>` in the generated docs HTML in a `.docs-table` scroll container so
 * wide reference tables scroll inside their own box instead of widening the page
 * (DESIGN.md §4: no horizontal overflow on /docs at 375).
 */
export function wrapTables(html: string): string {
  return html
    .replaceAll("<table", '<div class="docs-table"><table')
    .replaceAll("</table>", "</table></div>")
}
