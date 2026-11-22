export interface DocPageSection {
  readonly id: string
  readonly title: string
  readonly html: string
}

export interface DocPage {
  readonly lead: string
  readonly afterWidget: string
  readonly sections: readonly DocPageSection[]
}

const WIDGET_START = "<!-- install-tabs:start -->"
const WIDGET_END = "<!-- install-tabs:end -->"
const H2 = /^<h2 id="([^"]+)">([\s\S]*?)<\/h2>/

function headingText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim()
}

/**
 * Splits a compiled standalone doc page at its install-tabs markers (the block the site replaces
 * with the interactive widget) and then into one section per `##` heading for the sidebar.
 */
export function splitDocPage(html: string): DocPage {
  const start = html.indexOf(WIDGET_START)
  const end = html.indexOf(WIDGET_END)
  if (start < 0 || end < start) throw new Error("doc page is missing its install-tabs markers")

  const { lead: afterWidget, sections } = splitDocSections(html.slice(end + WIDGET_END.length))
  return { lead: html.slice(0, start), afterWidget, sections }
}

/** Splits a compiled standalone doc page into the text before its first `##` and one section per `##`. */
export function splitDocSections(html: string): Pick<DocPage, "lead" | "sections"> {
  const [lead = "", ...parts] = html.split(/(?=<h2[\s>])/)
  const sections = parts.map((part) => {
    const heading = H2.exec(part)
    if (!heading?.[1] || !heading[2])
      throw new Error(
        `doc page section does not start with an h2 that has an id: ${part.slice(0, 40)}`,
      )
    return { id: heading[1], title: headingText(heading[2]), html: part }
  })
  return { lead, sections }
}
